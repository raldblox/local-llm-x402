import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";

type MessageBody = {
  promptId?: string;
  promptText?: string;
  from?: string;
  text?: string;
  meta?: { txHash?: string; amount?: string; tokenUsage?: number };
};

type Message = {
  id: string;
  roomId: "demo";
  kind: "response";
  from: string;
  text: string;
  createdAt: number;
  promptId: string | null;
  meta?: { txHash?: string; amount?: string; tokenUsage?: number };
};

const MESSAGES_KEY = "room:demo:messages";

export async function POST(request: Request) {
  const body = (await request.json()) as MessageBody;
  if (!body?.promptId || !body?.from || !body?.text) {
    return NextResponse.json(
      { ok: false, error: "promptId, from, and text required" },
      { status: 400 }
    );
  }

  const message: Message = {
    id: crypto.randomUUID(),
    roomId: "demo",
    kind: "response",
    from: body.from,
    text: body.text,
    createdAt: Date.now(),
    promptId: body.promptId,
    meta: body.meta,
  };

  await redis.rpush(MESSAGES_KEY, JSON.stringify(message));

  return NextResponse.json({ ok: true, message });
}
