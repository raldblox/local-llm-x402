import { NextResponse } from 'next/server'
import { redis } from '@/lib/redis'
import { getRoomKeys, normalizeRoomId } from '@/lib/room'

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

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const roomId = normalizeRoomId(searchParams.get('roomId'))
  const { hostKey } = getRoomKeys(roomId)

  const hostRaw = await redis.get(hostKey)
  if (!hostRaw || typeof hostRaw !== 'string') {
    return NextResponse.json({ hostOnline: false, host: null })
  }

  try {
    const host = JSON.parse(hostRaw) as HostState
    return NextResponse.json({ hostOnline: Boolean(host?.modelConnected), host })
  } catch {
    return NextResponse.json({ hostOnline: false, host: null })
  }
}
