import { NextResponse } from 'next/server'
import { redis } from '@/lib/redis'
import { getRoomKeys, normalizeRoomId } from '@/lib/room'

type Message = {
  id: string
  roomId: string
  kind: 'prompt' | 'response' | 'system'
  from: string
  text: string
  createdAt: number
  promptId: string | null
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const roomId = normalizeRoomId(searchParams.get('roomId'))
  const afterRaw = searchParams.get('after')
  const after = afterRaw ? Number(afterRaw) : 0

  const { messagesKey } = getRoomKeys(roomId)
  const items = await redis.lrange(messagesKey, -200, -1)
  const parsed = items
    .map((item) => {
      try {
        return JSON.parse(item) as Message
      } catch {
        return null
      }
    })
    .filter((item): item is Message => Boolean(item))
    .filter((item) => item.createdAt > (Number.isFinite(after) ? after : 0))
    .sort((a, b) => a.createdAt - b.createdAt)

  return NextResponse.json({ messages: parsed })
}
