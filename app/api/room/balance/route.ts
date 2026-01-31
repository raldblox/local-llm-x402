import { NextResponse } from 'next/server'
import { redis } from '@/lib/redis'
import { getRoomKeys, normalizeRoomId } from '@/lib/room'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const roomId = normalizeRoomId(searchParams.get('roomId'))
  const addr = searchParams.get('addr')?.trim()
  const seedRaw = searchParams.get('seed')
  const seed = seedRaw ? Number(seedRaw) : null

  if (!addr) {
    return NextResponse.json({ balanceMicroUsdc: 0 })
  }

  const { balancesKey } = getRoomKeys(roomId)
  const current = await redis.hget(balancesKey, addr)
  if (current === null || current === undefined) {
    if (seed && Number.isFinite(seed)) {
      await redis.hset(balancesKey, { [addr]: Math.round(seed) })
      return NextResponse.json({ balanceMicroUsdc: Math.round(seed) })
    }
    return NextResponse.json({ balanceMicroUsdc: 0 })
  }

  const numeric = typeof current === 'string' ? Number(current) : Number(current)
  return NextResponse.json({
    balanceMicroUsdc: Number.isFinite(numeric) ? numeric : 0,
  })
}
