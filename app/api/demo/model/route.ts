import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";

type ModelPayload = {
  modelName: string;
  hostAddr?: string;
  updatedAt: number;
};

const MODEL_KEY = "room:demo:model";

export async function GET() {
  const payloadRaw = await redis.get<string>(MODEL_KEY);
  if (!payloadRaw) {
    return NextResponse.json({ ok: true, model: null });
  }

  let payload: ModelPayload | null = null;
  try {
    payload = JSON.parse(payloadRaw) as ModelPayload;
  } catch {
    payload = null;
  }

  return NextResponse.json({ ok: true, model: payload });
}

export async function POST(request: Request) {
  const body = (await request.json()) as { modelName?: string; hostAddr?: string };
  if (!body?.modelName) {
    return NextResponse.json({ ok: false, error: "modelName required" }, { status: 400 });
  }

  const payload: ModelPayload = {
    modelName: body.modelName,
    hostAddr: body.hostAddr,
    updatedAt: Date.now(),
  };

  await redis.set(MODEL_KEY, JSON.stringify(payload));

  return NextResponse.json({ ok: true, model: payload });
}
