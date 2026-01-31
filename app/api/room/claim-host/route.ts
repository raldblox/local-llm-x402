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
  const body = (await request.json()) as Body
  const roomId = normalizeRoomId(body.roomId)
  const hostAddr = body.hostAddr?.trim()
  const recvAddr = body.recvAddr?.trim()
  const lmStudioUrl = body.lmStudioUrl?.trim()
  const lmStudioToken = body.lmStudioToken?.trim()
  const modelId = body.modelId?.trim()
  const rateUsdcPer1k =
    typeof body.rateUsdcPer1k === 'number' && Number.isFinite(body.rateUsdcPer1k)
      ? body.rateUsdcPer1k
      : undefined

  if (!hostAddr || !recvAddr || !lmStudioUrl || !modelId || rateUsdcPer1k === undefined) {
    return NextResponse.json({ ok: false, error: 'Missing host config' }, { status: 400 })
  }

  const { hostKey, lockKey } = getRoomKeys(roomId)
  const lockValue = `lock_${hostAddr}_${Date.now()}`
  const lockAcquired = await redis.set(lockKey, lockValue, { nx: true, ex: 10 })

  if (!lockAcquired) {
    return NextResponse.json(
      { ok: false, error: 'Room already has an active host. Try again later.' },
      { status: 409 },
    )
  }

  try {
    const existing = await redis.get(hostKey)
    if (existing) {
      return NextResponse.json(
        { ok: false, error: 'Room already has an active host. Try again later.' },
        { status: 409 },
      )
    }

    const hostState = {
      hostAddr,
      recvAddr,
      lmStudioUrl,
      ...(lmStudioToken ? { lmStudioToken } : {}),
      modelId,
      rateUsdcPer1k,
      modelConnected: true,
      lastSeen: Date.now(),
    }

    await redis.set(hostKey, JSON.stringify(hostState))

    return NextResponse.json({ ok: true, host: hostState })
  } finally {
    await redis.del(lockKey)
  }
}
