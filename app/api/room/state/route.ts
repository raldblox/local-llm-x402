import { NextResponse } from 'next/server'
import { redis } from '@/lib/redis'
import { normalizeRoomId, getRoomKeys } from '@/lib/room'

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

const parseHost = (value: unknown): HostState | null => {
  if (!value || typeof value !== 'string') return null
  try {
    return JSON.parse(value) as HostState
  } catch {
    return null
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const roomId = normalizeRoomId(searchParams.get('roomId'))
  const { hostKey } = getRoomKeys(roomId)

  const hostRaw = await redis.get(hostKey)
  const host = parseHost(hostRaw)

  const publicHost = host
    ? {
        hostAddr: host.hostAddr,
        recvAddr: host.recvAddr,
        rateUsdcPer1k: host.rateUsdcPer1k,
        lmStudioUrl: host.lmStudioUrl,
        modelId: host.modelId,
        modelConnected: host.modelConnected,
        lastSeen: host.lastSeen,
      }
    : null

  return NextResponse.json({
    ok: true,
    hostOnline: Boolean(publicHost?.modelConnected),
    host: publicHost,
  })
}
