import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";

type Message = {
  id: string;
  roomId: "demo";
  kind: "prompt" | "response" | "system";
  from: string;
  text: string;
  createdAt: number;
  promptId: string | null;
  meta?: { txHash?: string; amount?: string; tokenUsage?: number };
};

const MESSAGES_KEY = "room:demo:messages";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const afterParam = searchParams.get("after");
  const after = afterParam ? Number(afterParam) : 0;

  const raw = await redis.lrange(MESSAGES_KEY, -200, -1);
  const parsed = raw
    .map((item) => {
      try {
        return JSON.parse(item) as Message;
      } catch {
        return null;
      }
    })
    .filter((item): item is Message => Boolean(item))
    .filter((item) => item.createdAt > after)
    .sort((a, b) => a.createdAt - b.createdAt);

  return NextResponse.json({ ok: true, messages: parsed });
}
