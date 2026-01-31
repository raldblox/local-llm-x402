import { LM_STUDIO_DEFAULT_BASE_URL } from '@/config/constants'

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
  temperature?: number
  signal?: AbortSignal
  systemPrompt?: string
}

interface LMStudioProxyOptions {
  baseUrl?: string
  targetUrl?: string
}

const normalizeBaseUrl = (input?: string) => {
  const trimmed = (input ?? LM_STUDIO_DEFAULT_BASE_URL).trim()

  if (!trimmed) {
    return LM_STUDIO_DEFAULT_BASE_URL
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
  const url = new URL(`${normalized}/v1/models`)

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
      },
    })

    if (!response.ok) {
      throw new Error(`LM Studio responded with ${response.status}`)
    }

    const payload = (await response.json()) as { data?: unknown[] }
    const list = Array.isArray(payload?.data) ? payload.data : []
    const normalizedList: Array<LMStudioModel | null> = list.map((model: unknown): LMStudioModel | null => {
      if (!model || typeof model !== 'object') {
        return null
      }

      const record = model as Record<string, unknown>
      const id = typeof record.id === 'string' ? record.id : typeof record.name === 'string' ? record.name : null

      if (!id) {
        return null
      }

      return {
        id,
        object: typeof record.object === 'string' ? record.object : undefined,
        owned_by: typeof record.owned_by === 'string' ? record.owned_by : undefined,
        description: typeof record.description === 'string' ? record.description : undefined,
        created: typeof record.created === 'number' ? record.created : undefined,
      }
    })

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
  temperature = 0.2,
  signal,
  systemPrompt,
}: LMStudioChatOptions): Promise<LMStudioChatResult> => {
  const normalized = normalizeBaseUrl(baseUrl)
  const target = targetUrl?.trim()
  const trimmedSystemPrompt = systemPrompt?.trim()

  try {
    const response = await fetch(`${normalized}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: modelId,
        stream: false,
        temperature,
        ...(target ? { target } : {}),
        messages: [
          ...(trimmedSystemPrompt ? [{ role: 'system', content: trimmedSystemPrompt }] : []),
          {
            role: 'user',
            content: prompt,
          },
        ],
      }),
      signal,
    })

    if (!response.ok) {
      throw new Error(`LM Studio responded with ${response.status}`)
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>
    }
    const message = payload?.choices?.[0]?.message?.content

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
