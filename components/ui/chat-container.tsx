'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Account,
  Aptos,
  AptosConfig,
  Ed25519PrivateKey,
  Network,
  PrivateKey,
  PrivateKeyVariants,
} from '@aptos-labs/ts-sdk';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import {
  Message as MessageBubble,
  MessageActions,
  MessageAvatar,
  MessageContent,
} from '@/components/ui/message';
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
  LM_STUDIO_DEFAULT_TARGET_URL,
  TOKEN_PRICE_UNIT,
} from '@/config/constants';
import { createLMStudioChatCompletion, fetchLMStudioModels } from '@/lib/lmstudio';
import type { Message } from '@/components/ui/chat-context';
import { useChatStore } from '@/components/ui/chat-context';
import {
  x402Client,
  wrapFetchWithPayment,
  decodePaymentResponseHeader,
} from '@rvk_rishikesh/fetch';
import { registerExactAptosScheme } from '@rvk_rishikesh/aptos/exact/client';

type LandingMode = 'root' | 'demo';
type DemoRole = 'host' | 'guest';

type ModelOption = {
  id: string;
  label: string;
};

type Identities = {
  hostAddr: string | null;
  guestAddr: string | null;
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

const DEFAULT_LM_URL = LM_STUDIO_DEFAULT_TARGET_URL;
const DEFAULT_RATE = DEFAULT_RATE_USDC_PER_1K;
const DEFAULT_GUEST_SEED = DEFAULT_GUEST_BALANCE_SEED;
const USDC_METADATA = '0x69091fbab5f7d635ee7ac5098cf0c1efbe31d68fec0f2cd565e8d168daf52832';
const USDC_DECIMALS = 6;

const mergeMessages = (existing: Message[], incoming: Message[]) => {
  const map = new Map(existing.map((msg) => [msg.id, msg]));
  incoming.forEach((msg) => map.set(msg.id, msg));
  return Array.from(map.values()).sort((a, b) => a.createdAt - b.createdAt);
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

const deriveAddress = (privateKey?: string | null, fallback?: string | null) => {
  const normalized = privateKey?.trim();
  if (normalized) {
    try {
      const formatted = PrivateKey.formatPrivateKey(normalized, PrivateKeyVariants.Ed25519);
      const hex = formatted.startsWith('0x') ? formatted.slice(2) : formatted;
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
  const { hostState, setHostState, messages, setMessages, balances, setBalance, addBalance } =
    useChatStore();
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
  const [chatInput, setChatInput] = useState('');
  const [sending, setSending] = useState(false);
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
  const [networkConsent, setNetworkConsent] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [fetchWithPayment, setFetchWithPayment] = useState<
    ((input: RequestInfo, init?: RequestInit) => Promise<Response>) | null
  >(null);
  const identityRole = role ?? (mode === 'demo' ? 'host' : 'guest');
  const hostOnline = Boolean(hostState?.modelConnected);
  const currentAddr =
    identityRole === 'host' ? (identities.hostAddr ?? identities.guestAddr) : identities.guestAddr;

  const canBecomeHost = !hostOnline && identityRole === 'guest';
  const hostRoute = mode === 'demo' ? '/demo/host' : '/host';
  const guestRoute = mode === 'demo' ? '/demo/guest' : '/guest';

  useEffect(() => {
    if (identityRole !== 'guest') return;
    const privateKeyRaw = process.env.NEXT_PUBLIC_DEMO_GUEST_PRIVATE_KEY;
    if (!privateKeyRaw) {
      setPaymentError('Missing guest private key for x402.');
      return;
    }
    try {
      const formatted = PrivateKey.formatPrivateKey(privateKeyRaw, PrivateKeyVariants.Ed25519);
      const hex = formatted.startsWith('0x') ? formatted.slice(2) : formatted;
      const privateKey = new Ed25519PrivateKey(hex);
      const account = Account.fromPrivateKey({ privateKey });
      const client = new x402Client();
      registerExactAptosScheme(client, { signer: account });
      const wrapped = wrapFetchWithPayment(fetch, client);
      setFetchWithPayment(() => wrapped);
      setPaymentError(null);
    } catch (error: unknown) {
      setPaymentError(error instanceof Error ? error.message : 'Failed to initialize payment.');
    }
  }, [identityRole]);

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
    fetchChainBalance();
  }, [fetchChainBalance, currentAddr]);

  useEffect(() => {
    if (!currentAddr) return;
    if (balances[currentAddr] !== undefined) return;
    const seed =
      identityRole === 'guest' && currentAddr === identities.guestAddr ? DEFAULT_GUEST_SEED : 0;
    setBalance(currentAddr, seed);
  }, [balances, currentAddr, identityRole, identities.guestAddr, setBalance]);

  const handleSend = async () => {
    if (sending) return;
    const userText = chatInput.trim();
    if (!userText || !currentAddr) return;

    setSending(true);
    setModalError(null);
    setChatInput('');

    try {
      const promptMessage: Message = {
        id: crypto.randomUUID(),
        roomId,
        kind: 'prompt',
        from: currentAddr ?? 'guest',
        text: userText,
        createdAt: Date.now(),
        promptId: null,
      };
      setMessages((prev) => mergeMessages(prev, [promptMessage]));

      if (!hostState?.modelConnected) {
        const systemMessage: Message = {
          id: crypto.randomUUID(),
          roomId,
          kind: 'system',
          from: 'system',
          text: 'No model connected.',
          createdAt: Date.now(),
          promptId: promptMessage.id,
        };
        setMessages((prev) => mergeMessages(prev, [systemMessage]));
        return;
      }

      const contextMessages = mergeMessages(messages, [promptMessage])
        .filter((msg) => msg.kind === 'prompt' || msg.kind === 'response')
        .slice(-12)
        .map((msg) => ({
          role: msg.kind === 'prompt' ? 'user' : 'assistant',
          content: msg.text,
        }));

      const isGuest = identityRole === 'guest' && currentAddr !== hostState.recvAddr;
      const endpoint = isGuest ? '/api/lmstudio/chat' : '/api/lmstudio/chat-free';
      const fetcher = isGuest && fetchWithPayment ? fetchWithPayment : fetch;
      let transactionHash: string | null = null;
      let amountMicroUsdc: number | null = null;
      let data: Record<string, unknown> | null = null;
      let text = '';

      if (isGuest && !fetchWithPayment) {
        const systemMessage: Message = {
          id: crypto.randomUUID(),
          roomId,
          kind: 'system',
          from: 'system',
          text: paymentError ?? 'Payment client not ready.',
          createdAt: Date.now(),
          promptId: promptMessage.id,
        };
        setMessages((prev) => mergeMessages(prev, [systemMessage]));
        return;
      }

      if (isGuest) {
        const paymentResponse = await fetcher(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            baseUrl: hostState.lmStudioUrl,
            token: hostState.lmStudioToken,
            modelId: hostState.modelId,
            messages: contextMessages,
            maxTokens: 256,
            rateUsdcPer1k: hostState.rateUsdcPer1k,
            dryRun: true,
          }),
        });

        if (!paymentResponse.ok && paymentResponse.status !== 402) {
          throw new Error(`Request failed with status ${paymentResponse.status}`);
        }

        const payHeader = paymentResponse.headers.get('PAYMENT-RESPONSE');
        if (payHeader) {
          try {
            const decoded = decodePaymentResponseHeader(payHeader) as Record<string, unknown>;
            transactionHash =
              typeof decoded?.transaction === 'string' ? decoded.transaction : transactionHash;
            const directAmount = decoded?.amount;
            const nestedAmount =
              (decoded?.price as { amount?: unknown } | undefined)?.amount ??
              (decoded?.payment as { amount?: unknown } | undefined)?.amount;
            const rawAmount =
              typeof directAmount === 'string' || typeof directAmount === 'number'
                ? directAmount
                : nestedAmount;
            if (typeof rawAmount === 'string' || typeof rawAmount === 'number') {
              const parsed = Number(rawAmount);
              if (Number.isFinite(parsed)) {
                amountMicroUsdc = parsed;
              }
            }
          } catch {
            // ignore decode errors
          }
        }

        if (paymentResponse.status === 402) {
          const systemMessage: Message = {
            id: crypto.randomUUID(),
            roomId,
            kind: 'system',
            from: 'system',
            text: 'Payment required. Please try again as guest with a funded wallet.',
            createdAt: Date.now(),
            promptId: promptMessage.id,
          };
          setMessages((prev) => mergeMessages(prev, [systemMessage]));
          return;
        }
      }

      const lmResult = await createLMStudioChatCompletion({
        targetUrl: hostState.lmStudioUrl,
        token: hostState.lmStudioToken,
        modelId: hostState.modelId,
        prompt: userText,
        messages: contextMessages,
      });

      text = lmResult.text;
      data = lmResult.raw as Record<string, unknown>;

      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        roomId,
        kind: 'response',
        from: hostState.hostAddr,
        text,
        createdAt: Date.now(),
        promptId: promptMessage.id,
        meta: {
          txHash: transactionHash ?? undefined,
          amountMicroUsdc:
            amountMicroUsdc !== null ? Math.round(amountMicroUsdc).toString() : undefined,
          tokenUsage:
            typeof (data as { usage?: { tokenUsage?: number } } | null)?.usage?.tokenUsage ===
            'number'
              ? (data as { usage: { tokenUsage: number } }).usage.tokenUsage
              : typeof (data as { stats?: { total_output_tokens?: number } } | null)?.stats
                    ?.total_output_tokens === 'number'
                ? (data as { stats: { total_output_tokens: number } }).stats.total_output_tokens
                : undefined,
          tokensPerSecond:
            typeof (data as { usage?: { tokensPerSecond?: number } } | null)?.usage
              ?.tokensPerSecond === 'number'
              ? (data as { usage: { tokensPerSecond: number } }).usage.tokensPerSecond
              : typeof (data as { stats?: { tokens_per_second?: number } } | null)?.stats
                    ?.tokens_per_second === 'number'
                ? (data as { stats: { tokens_per_second: number } }).stats.tokens_per_second
                : undefined,
          modelId: hostState.modelId,
        },
      };
      setMessages((prev) => mergeMessages(prev, [assistantMessage]));

      if (isGuest) {
        const usageToken =
          typeof (data as { usage?: { tokenUsage?: number } } | null)?.usage?.tokenUsage ===
          'number'
            ? (data as { usage: { tokenUsage: number } }).usage.tokenUsage
            : null;
        const computedMicro =
          typeof usageToken === 'number'
            ? Math.max(
                1,
                Math.round(
                  Math.ceil(usageToken / TOKEN_PRICE_UNIT) * hostState.rateUsdcPer1k * 1_000_000,
                ),
              )
            : null;
        const settledMicro = amountMicroUsdc ?? computedMicro;
        if (typeof settledMicro === 'number') {
          addBalance(currentAddr, -settledMicro);
          addBalance(hostState.recvAddr, settledMicro);
        }
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
    if (!networkConsent) {
      setModalError('Please approve local network access first.');
      return;
    }

    setModelLoading(true);
    setModalError(null);
    let timeout: ReturnType<typeof setTimeout> | null = null;

    try {
      const token = lmStudioToken.trim();
      const models = await Promise.race([
        fetchLMStudioModels({ targetUrl: trimmedUrl, token }),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error('LM Studio timed out. Check the URL and server status.')),
            7000,
          );
        }),
      ]);

      if (!models || models.length === 0) {
        throw new Error('No models found. Make sure a model is downloaded.');
      }

      const options = models.map((model) => ({ id: model.id, label: model.id }));
      setModelOptions(options);
      setModelId((prev) => prev || options[0]?.id || '');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to detect models';
      setModalError(message);
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

    setClaimLoading(true);
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
    setClaimLoading(false);
  };

  const handleReleaseHost = async () => {
    if (!currentAddr) return;
    setClaimLoading(true);
    setHostState(null);
    setModalOpen(false);
    setClaimLoading(false);
  };

  const balanceValue =
    chainBalance !== null
      ? `${chainBalance.toFixed(4)} USDC`
      : `${((balances[currentAddr ?? ''] ?? 0) / 1_000_000).toFixed(2)} USDC`;
  const bannerVisible = !hostOnline;
  const modelLabel = hostState?.modelId ? `Model: ${hostState.modelId}` : 'No model connected';
  const canOpenModal = identityRole === 'host';
  const navButtonLabel =
    identityRole === 'host'
      ? hostOnline
        ? modelLabel
        : 'Connect model'
      : hostState?.modelId
        ? modelLabel
        : 'No model connected';

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
            <div className="flex items-center gap-1 rounded-full border border-border/60 p-1 text-xs">
              <Button asChild size="sm" variant={identityRole === 'host' ? 'secondary' : 'ghost'}>
                <Link href={hostRoute}>Host</Link>
              </Button>
              <Button asChild size="sm" variant={identityRole === 'guest' ? 'secondary' : 'ghost'}>
                <Link href={guestRoute}>Guest</Link>
              </Button>
            </div>
            <Badge variant="secondary" className="px-3 py-1 text-xs">
              Balance: {chainBalanceLoading ? 'Loading...' : balanceValue}
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
                const isHostMessage = !isAssistant && message.from === hostState?.hostAddr;
                const isGuestMessage = !isAssistant && message.from === identities.guestAddr;
                const modelName = message.meta?.modelId ?? hostState?.modelId ?? 'Model';
                const senderLabel = isAssistant
                  ? modelName
                  : isHostMessage
                    ? 'Host'
                    : isGuestMessage
                      ? 'Guest'
                      : 'User';
                const senderInitial = isAssistant
                  ? modelName.slice(0, 2).toUpperCase()
                  : isHostMessage
                    ? 'H'
                    : isGuestMessage
                      ? 'G'
                      : 'U';
                const parsed =
                  message.kind === 'response'
                    ? parseReasoning(message.text)
                    : { content: message.text };
                const tokenUsage = message.meta?.tokenUsage;
                const tokensPerSecond = message.meta?.tokensPerSecond;
                const rateValue = hostState?.rateUsdcPer1k;
                const isHostViewer = identityRole === 'host';
                const settledMicro = message.meta?.amountMicroUsdc
                  ? Number(message.meta.amountMicroUsdc)
                  : null;
                const promptSource = isAssistant
                  ? messages.find((item) => item.id === message.promptId)
                  : null;
                const isHostPrompt = promptSource?.from === hostState?.hostAddr;
                const hasCost =
                  isAssistant &&
                  !isHostPrompt &&
                  (typeof settledMicro === 'number' ||
                    (tokenUsage && rateValue && typeof tokenUsage === 'number'));
                const costMicro =
                  hasCost && typeof settledMicro === 'number'
                    ? settledMicro
                    : hasCost && typeof tokenUsage === 'number' && typeof rateValue === 'number'
                      ? Math.ceil(tokenUsage / TOKEN_PRICE_UNIT) * rateValue * 1_000_000
                      : null;
                const costDisplay =
                  costMicro !== null
                    ? `${(costMicro / 1_000_000).toFixed(4)} USDC`
                    : isHostPrompt || isHostMessage || isHostViewer
                      ? '0.0000 USDC'
                      : null;
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
                    <MessageBubble className="w-full items-start justify-start">
                      <MessageAvatar
                        src=""
                        alt={senderLabel.toLowerCase()}
                        fallback={senderInitial}
                        className="bg-muted text-muted-foreground"
                      />
                      <div className="max-w-[72%] space-y-2">
                        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                          {senderLabel}
                          {!isAssistant && message.from
                            ? ` • ${message.from.slice(0, 6)}…${message.from.slice(-4)}`
                            : ''}
                        </div>
                        <MessageContent
                          markdown={message.kind === 'response'}
                          className={
                            isAssistant
                              ? 'bg-transparent text-foreground border border-border/40'
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
                    </MessageBubble>
                  </div>
                );
              })}
              {sending ? (
                <MessageBubble className="justify-start">
                  <MessageAvatar
                    src=""
                    alt="assistant"
                    fallback="AI"
                    className="bg-muted text-muted-foreground"
                  />
                  <MessageContent markdown className="text-muted-foreground">
                    Thinking...
                  </MessageContent>
                </MessageBubble>
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
                <p className="text-xs text-muted-foreground">
                  The browser will call the local proxy on port 4312 and forward to this target URL.
                </p>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                <div>
                  Allow local network access
                  <div className="text-[11px] text-muted-foreground/80">
                    Required to reach LM Studio or your agent URL.
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant={networkConsent ? 'secondary' : 'outline'}
                  onClick={() => setNetworkConsent((prev) => !prev)}
                >
                  {networkConsent ? 'Approved' : 'Approve'}
                </Button>
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
                <label className="text-muted-foreground">
                  Rate (USDC / {TOKEN_PRICE_UNIT} output tokens)
                </label>
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
