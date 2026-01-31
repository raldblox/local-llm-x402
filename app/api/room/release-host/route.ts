import { NextResponse } from 'next/server'
import { redis } from '@/lib/redis'
import { getRoomKeys, normalizeRoomId } from '@/lib/room'

type Body = {
  roomId?: string
  hostAddr?: string
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
    return NextResponse.json({ ok: true })
  }

  try {
    const hostState = JSON.parse(existing)
    if (hostState.hostAddr !== hostAddr) {
      return NextResponse.json({ ok: false, error: 'Host mismatch' }, { status: 403 })
    }
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid host state' }, { status: 500 })
  }

  await redis.del(hostKey)
  return NextResponse.json({ ok: true })
}
