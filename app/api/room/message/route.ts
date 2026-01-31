import { NextResponse } from 'next/server'
import { redis } from '@/lib/redis'
import { chargeForPrompt } from '@/lib/payments'
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
  const body = (await request.json()) as Body
  const roomId = normalizeRoomId(body.roomId)
  const from = body.from?.trim()
  const text = body.text?.trim()
  const maxTokens =
    typeof body.maxTokens === 'number' && Number.isFinite(body.maxTokens)
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
  if (!hostRaw) {
    return NextResponse.json({ ok: true, prompt: promptMessage })
  }

  let hostState: HostState | null = null
  try {
    if (typeof hostRaw !== 'string') {
      hostState = null
    } else {
      hostState = JSON.parse(hostRaw) as HostState
    }
  } catch {
    hostState = null
  }

  if (!hostState || !hostState.modelConnected) {
    return NextResponse.json({ ok: true, prompt: promptMessage })
  }

  const priceUsdc = Math.ceil(maxTokens / 1000) * hostState.rateUsdcPer1k
  const amountMicroUsdc = Math.max(1, Math.round(priceUsdc * 1_000_000))

  const charge = await chargeForPrompt({
    payerAddr: from,
    recvAddr: hostState.recvAddr,
    amountMicroUsdc,
  })

  if (!charge.ok) {
    const systemMessage: Message = {
      id: crypto.randomUUID(),
      roomId,
      kind: 'system',
      from: 'system',
      text: 'Payment failed. Try again later.',
      createdAt: Date.now(),
      promptId: promptMessage.id,
    }
    await appendMessage(messagesKey, systemMessage)
    return NextResponse.json({ ok: true, prompt: promptMessage, system: systemMessage })
  }

  await redis.hincrby(balancesKey, from, -amountMicroUsdc)
  await redis.hincrby(balancesKey, hostState.recvAddr, amountMicroUsdc)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12000)

  try {
    const rawMessages = await redis.lrange(messagesKey, -40, -1)
    const context = buildContext(rawMessages)
    const endpoint = `${normalizeBaseUrl(hostState.lmStudioUrl)}/chat/completions`

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(hostState.lmStudioToken
          ? { Authorization: `Bearer ${hostState.lmStudioToken}` }
          : {}),
      },
      body: JSON.stringify({
        model: hostState.modelId,
        messages: context,
        max_tokens: maxTokens,
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

    const payload = await response.json()
    const content = payload?.choices?.[0]?.message?.content
    const responseText = typeof content === 'string' ? content.trim() : ''
    if (!responseText) {
      throw new Error('Empty response from model')
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
        txHash: charge.txHash,
        amountMicroUsdc: amountMicroUsdc.toString(),
        tokenUsage: payload?.usage?.completion_tokens ?? undefined,
      },
    }

    await appendMessage(messagesKey, completionMessage)

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
