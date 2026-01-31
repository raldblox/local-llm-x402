'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Account, Aptos, AptosConfig, Ed25519PrivateKey, Network } from '@aptos-labs/ts-sdk';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Message, MessageActions, MessageAvatar, MessageContent } from '@/components/ui/message';
import { PromptInput, PromptInputActions, PromptInputTextarea } from '@/components/ui/prompt-input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ArrowUp, ChevronDown, ChevronUp, Coins, Gauge, Hash, Square } from 'lucide-react';
import {
  DEFAULT_GUEST_BALANCE_SEED,
  DEFAULT_RATE_USDC_PER_1K,
  LM_STUDIO_DEFAULT_BASE_URL,
} from '@/config/constants';

type LandingMode = 'root' | 'demo';
type DemoRole = 'host' | 'guest';

type Message = {
  id: string;
  roomId: string;
  kind: 'prompt' | 'response' | 'system';
  from: string;
  text: string;
  createdAt: number;
  promptId: string | null;
  meta?: {
    txHash?: string;
    amountMicroUsdc?: string;
    tokenUsage?: number;
    tokensPerSecond?: number;
    reasoningTokens?: number;
  };
};

type HostState = {
  hostAddr: string;
  recvAddr: string;
  rateUsdcPer1k: number;
  lmStudioUrl: string;
  lmStudioToken?: string;
  modelId: string;
  modelConnected: boolean;
  lastSeen: number;
};

type ModelOption = {
  id: string;
  label: string;
};

type Identities = {
  hostAddr: string | null;
  guestAddr: string | null;
};

type BalanceState = {
  microUsdc: number;
  status: 'idle' | 'loading';
};

type ParsedMessage = {
  content: string;
  reasoning?: string;
  parts?: Array<{ type: string; content: string }>;
};

const splitThoughtSteps = (input?: string) => {
  if (!input) return [];
  const lines = input
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  const looksNumbered = lines.some((line) => /^\d+[\).\s]/.test(line));
  const looksBulleted = lines.some((line) => /^[-*]\s+/.test(line));
  if (!looksNumbered && !looksBulleted) return [];

  return lines.map((line) => line.replace(/^(\d+[\).\s]|[-*]\s+)/, '').trim());
};

const DEFAULT_LM_URL = LM_STUDIO_DEFAULT_BASE_URL;
const DEFAULT_RATE = DEFAULT_RATE_USDC_PER_1K;
const DEFAULT_GUEST_SEED = DEFAULT_GUEST_BALANCE_SEED;
const USDC_METADATA = '0x69091fbab5f7d635ee7ac5098cf0c1efbe31d68fec0f2cd565e8d168daf52832';
const USDC_DECIMALS = 6;

const formatUsdc = (micro: number) => `${(micro / 1_000_000).toFixed(2)} USDC`;

const mergeMessages = (existing: Message[], incoming: Message[]) => {
  const map = new Map(existing.map((msg) => [msg.id, msg]));
  incoming.forEach((msg) => map.set(msg.id, msg));
  return Array.from(map.values()).sort((a, b) => a.createdAt - b.createdAt);
};

const extractLmStudioStats = (data: Record<string, unknown>) => {
  const stats = (data?.stats ?? data?.usage ?? data?.token_usage) as Record<string, unknown> | null;
  if (!stats) return null;
  const toNumber = (value: unknown) => (typeof value === 'number' ? value : null);
  const tokenUsage =
    toNumber(stats.total_output_tokens) ??
    toNumber(stats.output_tokens) ??
    toNumber(stats.completion_tokens);
  const tokensPerSecond =
    toNumber(stats.tokens_per_second) ?? toNumber(stats.tok_per_sec) ?? toNumber(stats.tps);
  const reasoningTokens = toNumber(stats.reasoning_output_tokens);
  if (tokenUsage === null && tokensPerSecond === null) return null;
  return { tokenUsage, tokensPerSecond, reasoningTokens };
};

const parseReasoning = (input: string): ParsedMessage => {
  const trimmed = input.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const parsed = JSON.parse(trimmed) as Array<{ type: string; content: string }>;
      if (Array.isArray(parsed)) {
        const reasoning = parsed.find((part) => part.type === 'reasoning')?.content?.trim();
        const message = parsed.find((part) => part.type === 'message')?.content?.trim();
        return {
          content:
            message ||
            parsed
              .map((part) => part.content)
              .join('\n')
              .trim() ||
            input,
          reasoning,
          parts: parsed,
        };
      }
    } catch {
      // fall through to tag parsing
    }
  }

  const thinkMatch = input.match(/<think>([\s\S]*?)<\/think>/i);
  const reasoningMatch = input.match(/<reasoning>([\s\S]*?)<\/reasoning>/i);
  const match = thinkMatch ?? reasoningMatch;
  if (!match) {
    return { content: input };
  }

  const reasoning = match[1]?.trim();
  const content = input.replace(match[0], '').trim();
  return {
    content: content.length > 0 ? content : input,
    reasoning,
  };
};

const useInterval = (callback: () => void, delay: number | null) => {
  const savedCallback = useRef(callback);
  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    if (delay === null) return;
    const id = setInterval(() => savedCallback.current(), delay);
    return () => clearInterval(id);
  }, [delay]);
};

const deriveAddress = (privateKey?: string | null, fallback?: string | null) => {
  const normalized = privateKey?.trim();
  if (normalized) {
    try {
      const hex = normalized.startsWith('0x') ? normalized.slice(2) : normalized;
      const key = new Ed25519PrivateKey(hex);
      return Account.fromPrivateKey({ privateKey: key }).accountAddress.toString();
    } catch {
      // fall through
    }
  }
  return fallback ?? null;
};

export default function ChatContainer({ mode, role }: { mode: LandingMode; role?: DemoRole }) {
  const roomId = mode === 'demo' ? 'demo' : 'global';
  const [identities] = useState<Identities>({
    hostAddr: deriveAddress(
      process.env.NEXT_PUBLIC_DEMO_HOST_PRIVATE_KEY,
      process.env.NEXT_PUBLIC_DEMO_HOST_ADDRESS,
    ),
    guestAddr: deriveAddress(
      process.env.NEXT_PUBLIC_DEMO_GUEST_PRIVATE_KEY,
      process.env.NEXT_PUBLIC_DEMO_GUEST_ADDRESS,
    ),
  });
  const [hostState, setHostState] = useState<HostState | null>(null);
  const [hostOnlineLocal, setHostOnlineLocal] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [lastSeen, setLastSeen] = useState(0);
  const [chatInput, setChatInput] = useState('');
  const [sending, setSending] = useState(false);
  const [balance, setBalance] = useState<BalanceState>({ microUsdc: 0, status: 'idle' });
  const [chainBalance, setChainBalance] = useState<number | null>(null);
  const [chainBalanceLoading, setChainBalanceLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [lmStudioUrl, setLmStudioUrl] = useState(DEFAULT_LM_URL);
  const [lmStudioToken, setLmStudioToken] = useState('');
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [modelId, setModelId] = useState('');
  const [rate, setRate] = useState(DEFAULT_RATE.toString());
  const [modalError, setModalError] = useState<string | null>(null);
  const [modelLoading, setModelLoading] = useState(false);
  const [claimLoading, setClaimLoading] = useState(false);
  const [shareLink, setShareLink] = useState('');
  const [hasInteracted, setHasInteracted] = useState(false);

  const identityRole = role ?? (mode === 'demo' ? 'host' : 'guest');
  const hostOnline =
    mode === 'demo' && identityRole === 'host'
      ? hostOnlineLocal
      : Boolean(hostState?.modelConnected);
  const currentAddr =
    identityRole === 'host' ? (identities.hostAddr ?? identities.guestAddr) : identities.guestAddr;

  const showGuestLink = mode === 'demo' && identityRole === 'host';
  const canBecomeHost = !hostOnline && identityRole === 'guest';
  const hostRoute = mode === 'demo' ? '/demo/host' : '/host';

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (mode !== 'demo') return;
    const url = new URL(window.location.href);
    url.pathname = '/demo/guest';
    setShareLink(url.toString());
  }, [mode]);

  useEffect(() => {
    if (!modalOpen || !hostState) return;
    setLmStudioUrl(hostState.lmStudioUrl || DEFAULT_LM_URL);
    setRate(hostState.rateUsdcPer1k?.toString() ?? DEFAULT_RATE.toString());
    setModelId(hostState.modelId ?? '');
    setModelLoading(false);
    setModalError(null);
    if (hostState.modelId) {
      setModelOptions((prev) => {
        if (prev.some((item) => item.id === hostState.modelId)) return prev;
        return [{ id: hostState.modelId, label: hostState.modelId }, ...prev];
      });
    }
  }, [modalOpen, hostState]);

  const fetchRoomState = useCallback(async () => {
    try {
      const response = await fetch(`/api/room/state?roomId=${roomId}`);
      const data = await response.json();
      setHostState(data?.host ?? null);
    } catch {
      // ignore
    }
  }, [roomId]);

  const fetchMessages = useCallback(async () => {
    try {
      const response = await fetch(`/api/room/messages?roomId=${roomId}&after=${lastSeen}`);
      const data = await response.json();
      const incoming = (data?.messages ?? []) as Message[];
      if (incoming.length > 0) {
        setMessages((prev) => mergeMessages(prev, incoming));
        setLastSeen((prev) => Math.max(prev, incoming[incoming.length - 1].createdAt));
      }
    } catch {
      // ignore
    }
  }, [roomId, lastSeen]);

  const fetchBalance = useCallback(async () => {
    if (!currentAddr) return;
    setBalance((prev) => ({ ...prev, status: 'loading' }));
    try {
      const seed =
        identityRole === 'guest' && currentAddr === identities.guestAddr ? DEFAULT_GUEST_SEED : 0;
      const response = await fetch(
        `/api/room/balance?roomId=${roomId}&addr=${currentAddr}&seed=${seed}`,
      );
      const data = await response.json();
      const microUsdc = Number(data?.balanceMicroUsdc ?? 0);
      if (Number.isFinite(microUsdc)) {
        setBalance({ microUsdc, status: 'idle' });
      }
    } catch {
      setBalance((prev) => ({ ...prev, status: 'idle' }));
    }
  }, [currentAddr, identityRole, identities.guestAddr, roomId]);

  const fetchChainBalance = useCallback(async () => {
    if (!currentAddr) return;
    setChainBalanceLoading(true);
    try {
      const aptos = new Aptos(new AptosConfig({ network: Network.TESTNET }));
      const raw = await aptos.getBalance({
        accountAddress: currentAddr,
        asset: USDC_METADATA,
      });
      const numeric = Number(raw) / 10 ** USDC_DECIMALS;
      setChainBalance(Number.isFinite(numeric) ? numeric : 0);
    } catch {
      setChainBalance(0);
    } finally {
      setChainBalanceLoading(false);
    }
  }, [currentAddr]);

  useEffect(() => {
    if (mode === 'demo' && identityRole === 'host') return;
    fetchRoomState();
  }, [fetchRoomState, mode, identityRole]);

  useEffect(() => {
    if (mode === 'demo' && identityRole === 'host') return;
    fetchBalance();
  }, [fetchBalance, mode, identityRole]);

  useEffect(() => {
    fetchChainBalance();
  }, [fetchChainBalance, currentAddr]);

  useInterval(fetchRoomState, mode === 'demo' && identityRole === 'host' ? null : 2500);
  useInterval(
    fetchMessages,
    mode === 'demo' && identityRole === 'host' ? null : hostOnline || hasInteracted ? 1200 : null,
  );
  useInterval(
    fetchBalance,
    mode === 'demo' && identityRole === 'host'
      ? null
      : currentAddr && (hostOnline || hasInteracted)
        ? 4000
        : null,
  );

  const handleSend = async () => {
    if (sending) return;
    const userText = chatInput.trim();
    if (!userText || !currentAddr) return;
    if (!hostOnline) {
      setChatInput('');
      return;
    }

    setHasInteracted(true);
    setSending(true);
    setModalError(null);
    setChatInput('');

    try {
      if (mode === 'demo' && identityRole === 'host') {
        const token = lmStudioToken.trim();
        const root = lmStudioUrl
          .trim()
          .replace(/\/+$/, '')
          .replace(/\/api\/v1$/i, '')
          .replace(/\/v1$/i, '');
        const endpoint = `${root}/api/v1/chat`;
        const userMessage: Message = {
          id: crypto.randomUUID(),
          roomId,
          kind: 'prompt',
          from: currentAddr ?? 'host',
          text: userText,
          createdAt: Date.now(),
          promptId: null,
        };
        setMessages((prev) => mergeMessages(prev, [userMessage]));
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            model: modelId,
            input: userText,
          }),
        });
        if (!response.ok) {
          throw new Error(`LM Studio responded with ${response.status}`);
        }
        const data = (await response.json()) as Record<string, unknown>;
        const output = data?.output ?? data?.response ?? data?.choices?.[0]?.message?.content ?? '';
        const stats = extractLmStudioStats(data);
        const assistantMessage: Message = {
          id: crypto.randomUUID(),
          roomId,
          kind: 'response',
          from: currentAddr ?? 'host',
          text: typeof output === 'string' ? output : JSON.stringify(output),
          createdAt: Date.now(),
          promptId: userMessage.id,
          meta: stats ?? undefined,
        };
        setMessages((prev) => mergeMessages(prev, [assistantMessage]));
        return;
      }

      const response = await fetch('/api/room/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId,
          from: currentAddr,
          text: userText,
          maxTokens: 256,
        }),
      });
      const data = await response.json();
      const nextMessages = [data?.prompt, data?.response, data?.system].filter(
        Boolean,
      ) as Message[];
      if (nextMessages.length > 0) {
        setMessages((prev) => mergeMessages(prev, nextMessages));
        setLastSeen((prev) => Math.max(prev, nextMessages[nextMessages.length - 1].createdAt));
      }
    } catch {
      // ignore
    } finally {
      setSending(false);
    }
  };

  const handleDetectModels = async () => {
    const trimmedUrl = lmStudioUrl.trim();
    if (!trimmedUrl) {
      setModalError('Enter a valid LM Studio URL.');
      return;
    }

    setModelLoading(true);
    setModalError(null);
    let timeout: ReturnType<typeof setTimeout> | null = null;

    try {
      const controller = new AbortController();
      timeout = setTimeout(() => controller.abort(), 7000);
      const token = lmStudioToken.trim();
      const isLocalUi =
        typeof window !== 'undefined' &&
        (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

      const directFetch = async () => {
        const root = trimmedUrl
          .replace(/\/+$/, '')
          .replace(/\/api\/v1$/i, '')
          .replace(/\/v1$/i, '');
        const candidates = [`${root}/api/v1/models`, `${root}/v1/models`];
        let lastError = 'Failed to reach LM Studio';

        for (const url of candidates) {
          try {
            const response = await fetch(url, {
              headers: {
                Accept: 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
              },
              signal: controller.signal,
            });
            if (!response.ok) {
              lastError = `LM Studio responded with ${response.status}`;
              continue;
            }
            const data = (await response.json()) as { models?: unknown[]; data?: unknown[] };
            return { ok: true, models: data?.models ?? data?.data ?? [] };
          } catch (error: unknown) {
            lastError = error instanceof Error ? error.message : lastError;
          }
        }

        return { ok: false, error: lastError };
      };

      if (!isLocalUi) {
        throw new Error('Run the UI on localhost to connect to LM Studio directly.');
      }

      const response = await directFetch();

      if (!response?.ok) {
        const errMsg =
          typeof response?.error === 'string' ? response.error : 'Failed to detect models';
        throw new Error(errMsg);
      }

      const models = Array.isArray(response.models) ? response.models : [];
      const options = models
        .map((model: unknown) => {
          if (!model || typeof model !== 'object') return null;
          const record = model as Record<string, unknown>;
          const id =
            typeof record.id === 'string'
              ? record.id
              : typeof record.key === 'string'
                ? record.key
                : typeof record.name === 'string'
                  ? record.name
                  : null;
          if (!id) return null;
          const label = typeof record.display_name === 'string' ? record.display_name : id;
          return { id, label };
        })
        .filter(Boolean) as ModelOption[];

      setModelOptions(options);
      if (options.length > 0) {
        setModelId(options[0].id);
      } else {
        setModalError('No models found. Make sure a model is downloaded.');
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to detect models';
      setModalError(
        error instanceof DOMException && error.name === 'AbortError'
          ? 'LM Studio timed out. Check the URL and server status.'
          : message,
      );
    } finally {
      if (timeout) clearTimeout(timeout);
      setModelLoading(false);
    }
  };

  const handleClaimHost = async () => {
    if (!currentAddr) {
      setModalError('Missing demo identity. Check NEXT_PUBLIC_DEMO_* env vars.');
      return;
    }
    if (!modelId) {
      setModalError('Select a model to go online.');
      return;
    }

    const parsedRate = Number(rate);
    if (!Number.isFinite(parsedRate) || parsedRate <= 0) {
      setModalError('Enter a valid rate.');
      return;
    }

    if (mode === 'demo' && identityRole === 'host') {
      setHostOnlineLocal(true);
      setHostState({
        hostAddr: currentAddr,
        recvAddr: currentAddr,
        lmStudioUrl: lmStudioUrl.trim(),
        lmStudioToken: lmStudioToken.trim() || undefined,
        modelId,
        rateUsdcPer1k: parsedRate,
        modelConnected: true,
        lastSeen: Date.now(),
      });
      setModalOpen(false);
      return;
    }

    setClaimLoading(true);
    setModalError(null);
    try {
      const response = await fetch('/api/room/claim-host', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId,
          hostAddr: currentAddr,
          recvAddr: currentAddr,
          lmStudioUrl: lmStudioUrl.trim(),
          lmStudioToken: lmStudioToken.trim() || undefined,
          modelId,
          rateUsdcPer1k: parsedRate,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error ?? 'Failed to go online');
      }
      setHostState(data?.host ?? null);
      setModalOpen(false);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to go online';
      setModalError(message);
    } finally {
      setClaimLoading(false);
    }
  };

  const handleReleaseHost = async () => {
    if (!currentAddr) return;
    if (mode === 'demo' && identityRole === 'host') {
      setHostOnlineLocal(false);
      setHostState(null);
      setModalOpen(false);
      return;
    }
    setClaimLoading(true);
    try {
      await fetch('/api/room/release-host', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId, hostAddr: currentAddr }),
      });
      setHostState(null);
      setModalOpen(false);
    } catch {
      // ignore
    } finally {
      setClaimLoading(false);
    }
  };

  const balanceLabel = identityRole === 'host' ? 'Balance' : 'Balance';
  const balanceValue =
    chainBalance !== null
      ? `${chainBalance.toFixed(4)} USDC`
      : `${(balance.microUsdc / 1_000_000).toFixed(2)} USDC`;
  const bannerVisible = !hostOnline;
  const modelLabel = hostState?.modelId ? `Model: ${hostState.modelId}` : 'No model connected';
  const canOpenModal = identityRole === 'host';
  const navButtonLabel =
    identityRole === 'host' ? (hostOnline ? modelLabel : 'Connect model') : 'No model connected';

  return (
    <div className="flex min-h-screen flex-col relative text-foreground">
      <header className="border-b bg-background sticky z-50! top-0 border-border/60">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <Button
              variant={hostOnline ? 'secondary' : 'default'}
              onClick={() => setModalOpen(true)}
              disabled={!canOpenModal}
            >
              <span className="flex items-center gap-2">
                {identityRole === 'host' ? (
                  <span
                    className={`h-2 w-2 rounded-full ${
                      hostOnline ? 'bg-emerald-400' : 'bg-muted-foreground/50'
                    }`}
                  />
                ) : null}
                {navButtonLabel}
              </span>
            </Button>
          </div>
          <div className="flex items-center gap-2">
            {showGuestLink ? (
              <Button asChild variant="ghost" size="sm">
                <Link href={shareLink || '/demo/guest'}>Guest Room</Link>
              </Button>
            ) : null}
            <Badge variant="secondary" className="px-3 py-1 text-xs">
              {balanceLabel}: {chainBalanceLoading ? 'Loading...' : balanceValue}
            </Badge>
          </div>
        </div>
      </header>

      <main className="mx-auto z-0 flex w-full max-w-5xl flex-1 flex-col px-4 py-6">
        <div className="flex flex-1 flex-col gap-4 rounded-2xl border border-border bg-muted/20 p-4">
          {bannerVisible ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-background/80 px-4 py-3 text-sm text-muted-foreground">
              <span>No model connected.</span>
              {canBecomeHost ? (
                <Button asChild size="sm">
                  <Link href={hostRoute}>Become host</Link>
                </Button>
              ) : null}
            </div>
          ) : null}

          <ScrollArea className="flex-1">
            <div className="flex flex-col gap-4 pb-6 text-sm">
              {messages.length === 0 ? (
                <div className="text-center text-muted-foreground">
                  {bannerVisible ? 'Waiting for a host to come online.' : 'Start the conversation.'}
                </div>
              ) : null}
              {messages.map((message) => {
                if (message.kind === 'system') {
                  return (
                    <div key={message.id} className="flex justify-center">
                      <div className="rounded-lg border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
                        {message.text}
                      </div>
                    </div>
                  );
                }

                const isAssistant = message.kind === 'response';
                const isCurrent = !isAssistant && message.from === currentAddr;
                const parsed =
                  message.kind === 'response'
                    ? parseReasoning(message.text)
                    : { content: message.text };
                const tokenUsage = message.meta?.tokenUsage;
                const tokensPerSecond = message.meta?.tokensPerSecond;
                const rateValue = hostState?.rateUsdcPer1k;
                const hasCost = isAssistant && tokenUsage && rateValue;
                const costMicro =
                  hasCost && typeof tokenUsage === 'number'
                    ? Math.ceil(tokenUsage / 1000) * rateValue * 1_000_000
                    : null;
                const costDisplay =
                  costMicro !== null ? `${(costMicro / 1_000_000).toFixed(4)} USDC` : null;
                const receiptLink =
                  typeof message.meta?.txHash === 'string' && message.meta.txHash.startsWith('0x')
                    ? `https://explorer.aptoslabs.com/txn/${message.meta.txHash}?network=testnet`
                    : null;

                return (
                  <div
                    key={message.id}
                    className={`flex flex-col ${isAssistant ? 'items-start' : 'items-end'}`}
                  >
                    {(parsed.reasoning || (parsed.parts && parsed.parts.length > 0)) &&
                    isAssistant ? (
                      <div className="mb-2 w-full">
                        {parsed.reasoning ? (
                          <MessageActions className="justify-start">
                            <Collapsible>
                              <CollapsibleTrigger className="group flex items-center gap-1 text-xs text-muted-foreground">
                                Thought
                                <ChevronDown className="h-3 w-3 group-data-[state=open]:hidden" />
                                <ChevronUp className="h-3 w-3 hidden group-data-[state=open]:inline" />
                              </CollapsibleTrigger>
                              <CollapsibleContent className="mt-2 px-3 py-2 text-xs text-muted-foreground text-left">
                                {splitThoughtSteps(parsed.reasoning).length > 0 ? (
                                  <ol className="list-decimal space-y-1 pl-4">
                                    {splitThoughtSteps(parsed.reasoning).map((step, index) => (
                                      <li key={`${message.id}-step-${index}`}>{step}</li>
                                    ))}
                                  </ol>
                                ) : (
                                  <div className="whitespace-pre-wrap">{parsed.reasoning}</div>
                                )}
                              </CollapsibleContent>
                            </Collapsible>
                          </MessageActions>
                        ) : null}
                        {parsed.parts && parsed.parts.length > 0 ? (
                          <div className="mt-2 space-y-2 text-xs text-muted-foreground">
                            {parsed.parts
                              .filter(
                                (part) => part.type !== 'reasoning' && part.type !== 'message',
                              )
                              .map((part, index) => (
                                <MessageContent key={`${message.id}-part-${index}`} markdown>
                                  {part.content}
                                </MessageContent>
                              ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    <Message
                      className={`w-full items-start ${
                        isAssistant ? 'justify-start' : isCurrent ? 'justify-end' : 'justify-start'
                      }`}
                    >
                      {isAssistant ? (
                        <MessageAvatar
                          src=""
                          alt="assistant"
                          fallback="AI"
                          className="bg-muted text-muted-foreground"
                        />
                      ) : null}
                      <div
                        className={`max-w-[72%] space-y-2 ${
                          isAssistant ? '' : isCurrent ? 'ml-auto text-right' : ''
                        }`}
                      >
                        <MessageContent
                          markdown={message.kind === 'response'}
                          className={
                            isAssistant
                              ? 'bg-transparent text-foreground border border-border/40'
                              : isCurrent
                                ? 'bg-transparent text-primary border border-primary/50'
                                : 'bg-transparent text-foreground border border-border/40'
                          }
                        >
                          {parsed.content}
                        </MessageContent>
                        {isAssistant ? (
                          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                            <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5">
                              <Hash className="h-3 w-3" />
                              {typeof tokenUsage === 'number' ? tokenUsage : '-'} tokens
                            </span>
                            <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5">
                              <Gauge className="h-3 w-3" />
                              {typeof tokensPerSecond === 'number'
                                ? tokensPerSecond.toFixed(2)
                                : '-'}{' '}
                              tok/sec
                            </span>
                            {receiptLink ? (
                              <a
                                href={receiptLink}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 hover:text-foreground"
                              >
                                <Coins className="h-3 w-3" />
                                {costDisplay ?? '-'} spent
                              </a>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5">
                                <Coins className="h-3 w-3" />
                                {costDisplay ?? '-'} spent
                              </span>
                            )}
                          </div>
                        ) : null}
                      </div>
                    </Message>
                  </div>
                );
              })}
              {sending ? (
                <Message className="justify-start">
                  <MessageAvatar
                    src=""
                    alt="assistant"
                    fallback="AI"
                    className="bg-muted text-muted-foreground"
                  />
                  <MessageContent markdown className="text-muted-foreground">
                    Thinking...
                  </MessageContent>
                </Message>
              ) : null}
            </div>
          </ScrollArea>

          <div className="sticky bottom-4 z-10">
            <PromptInput
              value={chatInput}
              onValueChange={setChatInput}
              onSubmit={handleSend}
              isLoading={sending}
              disabled={!hostOnline}
              className="rounded-2xl"
            >
              <PromptInputTextarea
                placeholder={hostOnline ? 'Send a message' : 'Host is offline'}
              />
              <PromptInputActions className="justify-end">
                <Button size="sm" onClick={handleSend} disabled={!hostOnline || sending}>
                  {sending ? (
                    <Square className="size-5 fill-current" />
                  ) : (
                    <ArrowUp className="size-5" />
                  )}
                </Button>
              </PromptInputActions>
            </PromptInput>
          </div>
        </div>
      </main>

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-lg rounded-2xl border border-border bg-background p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Connect LM Studio</h2>
              <Button variant="ghost" size="sm" onClick={() => setModalOpen(false)}>
                Close
              </Button>
            </div>

            <div className="mt-4 space-y-4 text-sm">
              <div className="space-y-2">
                <label className="text-muted-foreground">LM Studio URL</label>
                <Input
                  value={lmStudioUrl}
                  onChange={(event) => setLmStudioUrl(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-muted-foreground">Bearer token (optional)</label>
                <Input
                  value={lmStudioToken}
                  onChange={(event) => setLmStudioToken(event.target.value)}
                  placeholder="lm-studio-token"
                />
              </div>

              <div className="space-y-2">
                <label className="text-muted-foreground">Model</label>
                <div className="flex gap-2">
                  <Select value={modelId} onValueChange={setModelId}>
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Select model" />
                    </SelectTrigger>
                    <SelectContent>
                      {modelOptions.length === 0 ? (
                        <SelectItem value="none" disabled>
                          Detect models first
                        </SelectItem>
                      ) : (
                        modelOptions.map((model) => (
                          <SelectItem key={model.id} value={model.id}>
                            {model.label}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  <Button variant="secondary" onClick={handleDetectModels} disabled={modelLoading}>
                    {modelLoading ? 'Detecting...' : 'Connect LM Studio'}
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-muted-foreground">Rate (USDC / 1k output tokens)</label>
                <Input value={rate} onChange={(event) => setRate(event.target.value)} />
              </div>
            </div>

            {modalError ? <p className="mt-3 text-sm text-destructive">{modalError}</p> : null}

            <div className="mt-6 flex items-center justify-end gap-2">
              {hostOnline && hostState?.hostAddr === currentAddr ? (
                <Button variant="secondary" onClick={handleReleaseHost} disabled={claimLoading}>
                  Disconnect
                </Button>
              ) : null}
              <Button onClick={handleClaimHost} disabled={claimLoading}>
                {claimLoading ? 'Connecting...' : 'Go Online'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
