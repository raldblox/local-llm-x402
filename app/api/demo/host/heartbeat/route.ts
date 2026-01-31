import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";

type PresencePayload = {
  hostAddr: string;
  lastSeen: number;
};

const PRESENCE_KEY = "room:demo:presence";

export async function POST(request: Request) {
  const body = (await request.json()) as { hostAddr?: string };
  if (!body?.hostAddr) {
    return NextResponse.json({ ok: false, error: "hostAddr required" }, { status: 400 });
  }

  const payload: PresencePayload = {
    hostAddr: body.hostAddr,
    lastSeen: Date.now(),
  };

  await redis.set(PRESENCE_KEY, JSON.stringify(payload), { ex: 15 });

  return NextResponse.json({ ok: true });
}
