import { NextResponse } from 'next/server'
import { redis } from '@/lib/redis'
import { getRoomKeys, normalizeRoomId } from '@/lib/room'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const roomId = normalizeRoomId(searchParams.get('roomId'))
  const addr = searchParams.get('addr')?.trim()
  const seedParam = searchParams.get('seed')
  const seed =
    seedParam && Number.isFinite(Number(seedParam)) ? Math.round(Number(seedParam)) : undefined

  if (!addr) {
    return NextResponse.json({ ok: false, error: 'addr required' }, { status: 400 })
  }

  const { balancesKey } = getRoomKeys(roomId)
  const existing = await redis.hget(balancesKey, addr)

  if (existing === null && seed !== undefined) {
    await redis.hset(balancesKey, { [addr]: seed.toString() })
  }

  const value = existing ?? (seed !== undefined ? seed.toString() : '0')

  return NextResponse.json({ ok: true, balanceMicroUsdc: value })
}
