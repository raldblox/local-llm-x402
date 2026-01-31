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
  meta?: {
    txHash?: string
    amountMicroUsdc?: string
    tokenUsage?: number
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const roomId = normalizeRoomId(searchParams.get('roomId'))
  const afterParam = searchParams.get('after')
  const after = afterParam ? Number(afterParam) : 0

  const { messagesKey } = getRoomKeys(roomId)
  const raw = await redis.lrange(messagesKey, -200, -1)
  const parsed = raw
    .map((item) => {
      try {
        return JSON.parse(item) as Message
      } catch {
        return null
      }
    })
    .filter((item): item is Message => Boolean(item))
    .filter((item) => item.createdAt > after)
    .sort((a, b) => a.createdAt - b.createdAt)

  return NextResponse.json({ ok: true, messages: parsed })
}
