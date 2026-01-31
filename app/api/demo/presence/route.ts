import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";

type PresencePayload = {
  hostAddr: string;
  lastSeen: number;
};

const PRESENCE_KEY = "room:demo:presence";

export async function GET() {
  const payloadRaw = await redis.get<string>(PRESENCE_KEY);
  if (!payloadRaw) {
    return NextResponse.json({ ok: true, online: false, presence: null });
  }

  let payload: PresencePayload | null = null;
  try {
    payload = JSON.parse(payloadRaw) as PresencePayload;
  } catch {
    payload = null;
  }

  return NextResponse.json({ ok: true, online: Boolean(payload), presence: payload });
}
