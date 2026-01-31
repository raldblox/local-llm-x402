import { NextResponse } from 'next/server'
import { redis } from '@/lib/redis'
import { getRoomKeys, normalizeRoomId } from '@/lib/room'

type Body = {
  roomId?: string
  hostAddr?: string
}

type HostState = {
  hostAddr: string
  lastSeen?: number
}

const parseHostState = (value: unknown): HostState | null => {
  if (typeof value !== 'string') return null
  try {
    const parsed = JSON.parse(value) as HostState
    if (!parsed || typeof parsed !== 'object' || typeof parsed.hostAddr !== 'string') {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export async function POST(request: Request) {
  const body = (await request.json()) as Body
  const roomId = normalizeRoomId(body.roomId)
  const hostAddr = body.hostAddr?.trim()

  if (!hostAddr) {
    return NextResponse.json({ ok: false, error: 'hostAddr required' }, { status: 400 })
  }

  const { hostKey } = getRoomKeys(roomId)
  const existing = await redis.get(hostKey)
  if (!existing) {
    return NextResponse.json({ ok: false, error: 'No active host' }, { status: 404 })
  }

  const hostState = parseHostState(existing)
  if (!hostState) {
    return NextResponse.json({ ok: false, error: 'Invalid host state' }, { status: 500 })
  }

  if (hostState.hostAddr !== hostAddr) {
    return NextResponse.json({ ok: false, error: 'Host mismatch' }, { status: 403 })
  }

  hostState.lastSeen = Date.now()
  await redis.set(hostKey, JSON.stringify(hostState))

  return NextResponse.json({ ok: true, host: hostState })
}
