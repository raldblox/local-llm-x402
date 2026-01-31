export type ChargeResult = {
  ok: boolean
  txHash?: string
  error?: string
}

type ChargeInput = {
  payerAddr: string
  recvAddr: string
  amountMicroUsdc: number
}

import { randomUUID } from 'node:crypto'

export const chargeForPrompt = async ({ amountMicroUsdc }: ChargeInput): Promise<ChargeResult> => {
  if (!Number.isFinite(amountMicroUsdc) || amountMicroUsdc <= 0) {
    return { ok: false, error: 'Invalid amount' }
  }

  return {
    ok: true,
    txHash: `demo_${randomUUID().slice(0, 12)}`,
  }
}
