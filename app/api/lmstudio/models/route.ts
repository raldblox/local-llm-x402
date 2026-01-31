import { NextRequest, NextResponse } from 'next/server'

import { LM_STUDIO_DEFAULT_BASE_URL } from '@/config/constants'

const normalizeBaseUrl = (input?: string) => {
  const trimmed = (input ?? LM_STUDIO_DEFAULT_BASE_URL).trim()

  if (!trimmed) {
    return LM_STUDIO_DEFAULT_BASE_URL
  }

  return trimmed.replace(/\/+$/, '')
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const baseUrl = searchParams.get('baseUrl') ?? searchParams.get('url') ?? undefined
  const token = searchParams.get('token') ?? undefined
  const normalized = normalizeBaseUrl(baseUrl)

  try {
    const endpoints = [`${normalized}/api/v1/models`, `${normalized}/v1/models`]
    let lastStatus = 502
    let lastError = 'Failed to reach LM Studio'

    for (const endpoint of endpoints) {
      const response = await fetch(endpoint, {
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      })

      if (!response.ok) {
        lastStatus = response.status
        lastError = `LM Studio responded with ${response.status}`
        continue
      }

      const payload = await response.json()

      return NextResponse.json(payload)
    }

    return NextResponse.json(
      { error: lastError },
      { status: lastStatus === 404 ? 404 : 502 },
    )
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to reach LM Studio' },
      {
        status: 502,
      },
    )
  }
}
