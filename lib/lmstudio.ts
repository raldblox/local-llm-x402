'use client'

import {
  LM_STUDIO_DEFAULT_TARGET_URL,
  LM_STUDIO_PROXY_BASE_URL,
} from '@/config/constants'

export interface LMStudioModel {
  id: string
  object?: string
  owned_by?: string
  description?: string
  created?: number
}

export interface LMStudioChatResult {
  text: string
  modelId: string
  raw?: unknown
}

export interface LMStudioChatOptions {
  baseUrl?: string
  targetUrl?: string
  modelId: string
  prompt: string
  messages?: Array<{ role: string; content: string }>
  token?: string
  temperature?: number
  signal?: AbortSignal
  systemPrompt?: string
}

interface LMStudioProxyOptions {
  baseUrl?: string
  targetUrl?: string
  token?: string
}

const normalizeBaseUrl = (input?: string) => {
  const trimmed = (input ?? LM_STUDIO_PROXY_BASE_URL).trim()

  if (!trimmed) {
    return LM_STUDIO_PROXY_BASE_URL
  }

  return trimmed.replace(/\/+$/, '')
}

const stripThinkingSegments = (input: string): string => {
  if (!input.includes('<think')) {
    return input
  }

  const removedBlocks = input.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<\/?think>/gi, '')

  const normalized = removedBlocks.trim()

  return normalized.length > 0 ? normalized : input
}

const withAgentError = (baseUrl: string, message: string) => {
  return `Failed to reach local agent at ${baseUrl}: ${message}`
}

const buildModelsEndpoint = (options?: LMStudioProxyOptions) => {
  const normalized = normalizeBaseUrl(options?.baseUrl)
  const target = options?.targetUrl?.trim()
  const url = new URL(`${normalized}/api/v1/models`)

  if (target) {
    url.searchParams.set('target', target)
  }

  return { normalized, url }
}

export const fetchLMStudioModels = async (options?: LMStudioProxyOptions): Promise<LMStudioModel[]> => {
  const { normalized, url } = buildModelsEndpoint(options)

  try {
    const response = await fetch(url, {
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        ...(options?.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
    })

    if (!response.ok) {
      throw new Error(`LM Studio responded with ${response.status}`)
    }

    const payload = (await response.json()) as
      | {
          data?: unknown[]
          models?: unknown[]
          modelList?: unknown[]
        }
      | unknown[]
    const list = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.data)
        ? payload.data
        : Array.isArray(payload?.models)
          ? payload.models
          : Array.isArray(payload?.modelList)
            ? payload.modelList
            : []
    const normalizedList: Array<LMStudioModel | null> = list.map(
      (model: unknown): LMStudioModel | null => {
        if (typeof model === 'string') {
          return { id: model }
        }

        if (!model || typeof model !== 'object') {
          return null
        }

        const record = model as Record<string, unknown>
        const id =
          typeof record.id === 'string'
            ? record.id
            : typeof record.model === 'string'
              ? record.model
              : typeof record.name === 'string'
                ? record.name
                : typeof record.key === 'string'
                  ? record.key
                  : typeof record.selected_variant === 'string'
                    ? record.selected_variant
                    : Array.isArray(record.variants) && typeof record.variants[0] === 'string'
                      ? record.variants[0]
                      : null

        if (!id) {
          return null
        }

        return {
          id,
          object: typeof record.object === 'string' ? record.object : undefined,
          owned_by: typeof record.owned_by === 'string' ? record.owned_by : undefined,
          description:
            typeof record.description === 'string'
              ? record.description
              : typeof record.display_name === 'string'
                ? record.display_name
                : undefined,
          created: typeof record.created === 'number' ? record.created : undefined,
        }
      },
    )

    return normalizedList.filter((entry): entry is LMStudioModel => Boolean(entry))
  } catch (error: unknown) {
    throw new Error(
      withAgentError(normalized, error instanceof Error ? error.message : 'Unknown error'),
    )
  }
}

export const createLMStudioChatCompletion = async ({
  baseUrl,
  targetUrl,
  modelId,
  prompt,
  messages,
  token,
  temperature = 0.2,
  signal,
  systemPrompt,
}: LMStudioChatOptions): Promise<LMStudioChatResult> => {
  const normalized = normalizeBaseUrl(baseUrl)
  const target = targetUrl?.trim() || LM_STUDIO_DEFAULT_TARGET_URL
  const trimmedSystemPrompt = systemPrompt?.trim()

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (token) {
      headers.Authorization = `Bearer ${token}`
    }

    const requestMessages =
      messages && messages.length > 0
        ? messages
        : [
            ...(trimmedSystemPrompt ? [{ role: 'system', content: trimmedSystemPrompt }] : []),
            { role: 'user', content: prompt },
          ]

    const lastMessage =
      requestMessages.length > 0 ? requestMessages[requestMessages.length - 1]?.content : prompt

    const response = await fetch(`${normalized}/api/v1/chat`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: modelId,
        input: typeof lastMessage === 'string' ? lastMessage : prompt,
        temperature,
        ...(target ? { target } : {}),
      }),
      signal,
    })

    if (!response.ok) {
      throw new Error(`LM Studio responded with ${response.status}`)
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>
      output?: unknown
      response?: unknown
    }
    const message =
      Array.isArray(payload.output)
        ? JSON.stringify(payload.output)
        : typeof payload.output === 'string'
          ? payload.output
          : typeof payload.response === 'string'
            ? payload.response
            : payload?.choices?.[0]?.message?.content

    if (typeof message !== 'string') {
      throw new Error('LM Studio response missing content')
    }

    const cleaned = stripThinkingSegments(message)

    return {
      text: cleaned,
      modelId,
      raw: payload,
    }
  } catch (error: unknown) {
    throw new Error(
      withAgentError(normalized, error instanceof Error ? error.message : 'Unknown error'),
    )
  }
}
