import { NextRequest, NextResponse } from 'next/server'

import { LM_STUDIO_DEFAULT_TARGET_URL } from '@/config/constants'

const normalizeBaseUrl = (input?: string) => {
  const trimmed = (input ?? LM_STUDIO_DEFAULT_TARGET_URL).trim()

  if (!trimmed) {
    return LM_STUDIO_DEFAULT_TARGET_URL
  }

  return trimmed.replace(/\/+$/, '')
}

type Body = {
  baseUrl?: string
  token?: string
  modelId?: string
  prompt?: string
  messages?: Array<{ role: string; content: string }>
  temperature?: number
  maxTokens?: number
  dryRun?: boolean
}

const parseTokenUsage = (payload: Record<string, unknown>) => {
  const usage = payload?.usage as Record<string, unknown> | undefined
  const stats = payload?.stats as Record<string, unknown> | undefined
  const tokenUsage =
    (typeof usage?.completion_tokens === 'number' && usage.completion_tokens) ||
    (typeof stats?.total_output_tokens === 'number' && stats.total_output_tokens) ||
    (typeof stats?.output_tokens === 'number' && stats.output_tokens) ||
    null
  const tokensPerSecond =
    (typeof stats?.tokens_per_second === 'number' && stats.tokens_per_second) ||
    (typeof usage?.tokens_per_second === 'number' && usage.tokens_per_second) ||
    null
  return {
    tokenUsage,
    tokensPerSecond,
  }
}

const extractText = (payload: Record<string, unknown>) => {
  const output = payload?.output ?? payload?.response
  if (Array.isArray(output)) {
    return JSON.stringify(output)
  }
  if (typeof output === 'string' && output.trim().length > 0) {
    return output.trim()
  }
  const choices = payload?.choices as Array<{ message?: { content?: unknown } }> | undefined
  const content = choices?.[0]?.message?.content
  if (typeof content === 'string') {
    return content.trim()
  }
  return ''
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as Body | null

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  const baseUrl = typeof body.baseUrl === 'string' ? body.baseUrl : undefined
  const token = typeof body.token === 'string' ? body.token : undefined
  const modelId = typeof body.modelId === 'string' ? body.modelId : ''
  const prompt = typeof body.prompt === 'string' ? body.prompt : ''
  const messages = Array.isArray(body.messages) ? body.messages : undefined
  const temperature =
    typeof body.temperature === 'number' && Number.isFinite(body.temperature)
      ? body.temperature
      : 0.2

  const dryRun = Boolean(body.dryRun)

  if (!modelId || (!prompt && (!messages || messages.length === 0))) {
    return NextResponse.json({ error: 'modelId and prompt/messages are required' }, { status: 400 })
  }

  const normalized = normalizeBaseUrl(baseUrl)

  try {
    if (dryRun) {
      return NextResponse.json({ ok: true, dryRun: true })
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (token) {
      headers.Authorization = `Bearer ${token}`
    }

    const lmResponse = await fetch(`${normalized}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: modelId,
        messages:
          messages && messages.length > 0
            ? messages
            : [{ role: 'user', content: prompt }],
        temperature,
      }),
    })

    if (!lmResponse.ok) {
      return NextResponse.json(
        { error: `LM Studio responded with ${lmResponse.status}` },
        { status: lmResponse.status === 404 ? 404 : 502 },
      )
    }

    const payload = (await lmResponse.json()) as Record<string, unknown>

    const text = extractText(payload)
    const { tokenUsage, tokensPerSecond } = parseTokenUsage(payload)

    return NextResponse.json({
      ok: true,
      text,
      raw: payload,
      stats: (payload as Record<string, unknown>)?.stats ?? null,
      usage: {
        tokenUsage,
        tokensPerSecond,
      },
    })
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to reach LM Studio' },
      { status: 502 },
    )
  }
}

