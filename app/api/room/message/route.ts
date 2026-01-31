import { NextResponse } from 'next/server'
import { redis } from '@/lib/redis'
import { getRoomKeys, normalizeRoomId } from '@/lib/room'

type Body = {
  roomId?: string
  from?: string
  text?: string
  maxTokens?: number
}

type HostState = {
  hostAddr: string
  recvAddr: string
  rateUsdcPer1k: number
  lmStudioUrl: string
  lmStudioToken?: string
  modelId: string
  modelConnected: boolean
  lastSeen: number
}

type Message = {
  id: string
  roomId: string
  kind: 'prompt' | 'response' | 'system'
  from: string
  text: string
  createdAt: number
  promptId: string | null
  meta?: {
    txHash?: string
    amountMicroUsdc?: string
    tokenUsage?: number
    tokensPerSecond?: number
  }
}

const normalizeBaseUrl = (input: string) => input.trim().replace(/\/+$/, '')

const buildContext = (raw: string[]) => {
  const parsed = raw
    .map((item) => {
      try {
        return JSON.parse(item) as Message
      } catch {
        return null
      }
    })
    .filter((item): item is Message => Boolean(item))
    .filter((item) => item.kind === 'prompt' || item.kind === 'response')
    .slice(-12)

  return parsed.map((item) => ({
    role: item.kind === 'prompt' ? 'user' : 'assistant',
    content: item.text,
  }))
}

const appendMessage = async (key: string, message: Message) => {
  await redis.rpush(key, JSON.stringify(message))
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Body | null
  const roomId = normalizeRoomId(body?.roomId)
  const from = body?.from?.trim()
  const text = body?.text?.trim()
  const maxTokens =
    typeof body?.maxTokens === 'number' && Number.isFinite(body.maxTokens)
      ? Math.max(1, Math.min(2048, Math.round(body.maxTokens)))
      : 256

  if (!from || !text) {
    return NextResponse.json({ ok: false, error: 'from and text required' }, { status: 400 })
  }

  const { messagesKey, hostKey, balancesKey } = getRoomKeys(roomId)
  const promptMessage: Message = {
    id: crypto.randomUUID(),
    roomId,
    kind: 'prompt',
    from,
    text,
    createdAt: Date.now(),
    promptId: null,
  }

  await appendMessage(messagesKey, promptMessage)

  const hostRaw = await redis.get(hostKey)
  if (!hostRaw || typeof hostRaw !== 'string') {
    return NextResponse.json({ ok: true, prompt: promptMessage })
  }

  let hostState: HostState | null = null
  try {
    hostState = JSON.parse(hostRaw) as HostState
  } catch {
    hostState = null
  }

  if (!hostState || !hostState.modelConnected) {
    return NextResponse.json({ ok: true, prompt: promptMessage })
  }

  const priceEstimateUsdc = Math.ceil(maxTokens / 1000) * hostState.rateUsdcPer1k
  const minRequiredMicro = Math.max(1, Math.round(priceEstimateUsdc * 1_000_000))
  const currentBalanceRaw = await redis.hget(balancesKey, from)
  const currentBalance =
    typeof currentBalanceRaw === 'string' ? Number(currentBalanceRaw) : Number(currentBalanceRaw)

  if (!Number.isFinite(currentBalance) || currentBalance < minRequiredMicro) {
    const systemMessage: Message = {
      id: crypto.randomUUID(),
      roomId,
      kind: 'system',
      from: 'system',
      text: 'Insufficient balance. Please top up to continue.',
      createdAt: Date.now(),
      promptId: promptMessage.id,
    }
    await appendMessage(messagesKey, systemMessage)
    return NextResponse.json({ ok: true, prompt: promptMessage, system: systemMessage })
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12000)

  try {
    const rawMessages = await redis.lrange(messagesKey, -40, -1)
    const context = buildContext(rawMessages)
    const endpoint = new URL('/api/lmstudio/chat', request.url)

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        baseUrl: normalizeBaseUrl(hostState.lmStudioUrl),
        token: hostState.lmStudioToken,
        modelId: hostState.modelId,
        messages: context,
        maxTokens,
        payerAddr: from,
        recvAddr: hostState.recvAddr,
        rateUsdcPer1k: hostState.rateUsdcPer1k,
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      const systemMessage: Message = {
        id: crypto.randomUUID(),
        roomId,
        kind: 'system',
        from: 'system',
        text: 'Host model unreachable.',
        createdAt: Date.now(),
        promptId: promptMessage.id,
      }
      await appendMessage(messagesKey, systemMessage)
      return NextResponse.json({ ok: true, prompt: promptMessage, system: systemMessage })
    }

    const payload = (await response.json()) as {
      ok?: boolean
      text?: string
      usage?: { tokenUsage?: number; tokensPerSecond?: number }
      charge?: { ok?: boolean; txHash?: string }
      amountMicroUsdc?: number | null
    }
    const responseText = typeof payload?.text === 'string' ? payload.text.trim() : ''
    if (!responseText) {
      throw new Error('Empty response from model')
    }

    const amountMicroUsdc =
      typeof payload.amountMicroUsdc === 'number' && Number.isFinite(payload.amountMicroUsdc)
        ? payload.amountMicroUsdc
        : null
    const chargeOk = payload.charge?.ok === true
    const txHash = chargeOk ? payload.charge?.txHash : undefined

    if (chargeOk && amountMicroUsdc) {
      await redis.hincrby(balancesKey, from, -amountMicroUsdc)
      await redis.hincrby(balancesKey, hostState.recvAddr, amountMicroUsdc)
    }

    const completionMessage: Message = {
      id: crypto.randomUUID(),
      roomId,
      kind: 'response',
      from: hostState.hostAddr,
      text: responseText,
      createdAt: Date.now(),
      promptId: promptMessage.id,
      meta: {
        txHash,
        amountMicroUsdc: amountMicroUsdc ? amountMicroUsdc.toString() : undefined,
        tokenUsage:
          typeof payload.usage?.tokenUsage === 'number' ? payload.usage.tokenUsage : undefined,
        tokensPerSecond:
          typeof payload.usage?.tokensPerSecond === 'number'
            ? payload.usage.tokensPerSecond
            : undefined,
      },
    }

    await appendMessage(messagesKey, completionMessage)

    if (!chargeOk) {
      const systemMessage: Message = {
        id: crypto.randomUUID(),
        roomId,
        kind: 'system',
        from: 'system',
        text: 'Payment failed. Host was not paid.',
        createdAt: Date.now(),
        promptId: promptMessage.id,
      }
      await appendMessage(messagesKey, systemMessage)
      return NextResponse.json({
        ok: true,
        prompt: promptMessage,
        response: completionMessage,
        system: systemMessage,
      })
    }

    return NextResponse.json({ ok: true, prompt: promptMessage, response: completionMessage })
  } catch {
    const systemMessage: Message = {
      id: crypto.randomUUID(),
      roomId,
      kind: 'system',
      from: 'system',
      text: 'Host model unreachable.',
      createdAt: Date.now(),
      promptId: promptMessage.id,
    }
    await appendMessage(messagesKey, systemMessage)
    return NextResponse.json({ ok: true, prompt: promptMessage, system: systemMessage })
  } finally {
    clearTimeout(timeout)
  }
}
