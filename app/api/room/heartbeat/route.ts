import { NextResponse } from 'next/server'
import { redis } from '@/lib/redis'
import { getRoomKeys, normalizeRoomId } from '@/lib/room'

type Body = {
  roomId?: string
  hostAddr?: string
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Body | null
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ ok: false, error: 'Invalid payload' }, { status: 400 })
  }

  const roomId = normalizeRoomId(body.roomId)
  const hostAddr = body.hostAddr?.trim()
  if (!hostAddr) {
    return NextResponse.json({ ok: false, error: 'hostAddr required' }, { status: 400 })
  }

  const { hostKey } = getRoomKeys(roomId)
  const raw = await redis.get(hostKey)
  if (!raw || typeof raw !== 'string') {
    return NextResponse.json({ ok: false, error: 'No host online' }, { status: 404 })
  }

  try {
    const hostState = JSON.parse(raw) as { hostAddr?: string }
    if (hostState.hostAddr !== hostAddr) {
      return NextResponse.json({ ok: false, error: 'Host mismatch' }, { status: 403 })
    }

    const next = { ...hostState, lastSeen: Date.now() }
    await redis.set(hostKey, JSON.stringify(next), { ex: 15 })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid host state' }, { status: 500 })
  }
}
