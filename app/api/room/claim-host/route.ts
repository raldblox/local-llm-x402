import { NextResponse } from 'next/server'
import { redis } from '@/lib/redis'
import { getRoomKeys, normalizeRoomId } from '@/lib/room'

type Body = {
  roomId?: string
  hostAddr?: string
  recvAddr?: string
  lmStudioUrl?: string
  lmStudioToken?: string
  modelId?: string
  rateUsdcPer1k?: number
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Body | null
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ ok: false, error: 'Invalid payload' }, { status: 400 })
  }

  const roomId = normalizeRoomId(body.roomId)
  const hostAddr = body.hostAddr?.trim()
  const recvAddr = body.recvAddr?.trim() ?? hostAddr
  const lmStudioUrl = body.lmStudioUrl?.trim()
  const modelId = body.modelId?.trim()
  const rateUsdcPer1k =
    typeof body.rateUsdcPer1k === 'number' && Number.isFinite(body.rateUsdcPer1k)
      ? body.rateUsdcPer1k
      : null

  if (!hostAddr || !recvAddr || !lmStudioUrl || !modelId || !rateUsdcPer1k) {
    return NextResponse.json({ ok: false, error: 'Missing required fields' }, { status: 400 })
  }

  const { hostKey, lockKey } = getRoomKeys(roomId)
  const lock = await redis.set(lockKey, hostAddr, { nx: true, ex: 10 })
  if (!lock) {
    return NextResponse.json({ ok: false, error: 'Host claim busy' }, { status: 429 })
  }

  try {
    const existing = await redis.get(hostKey)
    if (existing && typeof existing === 'string') {
      return NextResponse.json(
        { ok: false, error: 'Room already has an active host.' },
        { status: 409 },
      )
    }

    const hostState = {
      hostAddr,
      recvAddr,
      rateUsdcPer1k,
      lmStudioUrl,
      lmStudioToken: body.lmStudioToken?.trim() || undefined,
      modelId,
      modelConnected: true,
      lastSeen: Date.now(),
    }

    await redis.set(hostKey, JSON.stringify(hostState), { ex: 15 })
    return NextResponse.json({ ok: true, host: hostState })
  } finally {
    await redis.del(lockKey)
  }
}
