import { paymentProxy } from '@rvk_rishikesh/next'
import { x402ResourceServer, HTTPFacilitatorClient } from '@rvk_rishikesh/core/server'
import { ExactAptosScheme } from '@rvk_rishikesh/aptos/exact/server'
import type { Network } from '@rvk_rishikesh/core/types'
import { NextRequest, NextResponse } from 'next/server'
import { TOKEN_PRICE_UNIT } from '@/config/constants'

const FACILITATOR_URL = process.env.FACILITATOR_URL || 'https://x402-navy.vercel.app/facilitator/'
const PAY_TO =
  process.env.PAYMENT_RECIPIENT_ADDRESS ||
  '0x840ae5d03ad922e93fd2f6c17a55435bf0bdfebd8846ff8d5d3a362cc6b890b4'

const facilitator = new HTTPFacilitatorClient({ url: FACILITATOR_URL })
const aptosScheme = new ExactAptosScheme()

aptosScheme.registerMoneyParser(async (amount: number) => {
  const decimals = 6
  const atomicAmount = BigInt(Math.round(amount * Math.pow(10, decimals))).toString()
  return {
    amount: atomicAmount,
    asset: '0x69091fbab5f7d635ee7ac5098cf0c1efbe31d68fec0f2cd565e8d168daf52832',
    extra: { symbol: 'USDC' },
  }
})

const resourceServer = new x402ResourceServer([facilitator]).register(
  'aptos:2' as Network,
  aptosScheme,
)

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname
  if (path.startsWith('/api/lmstudio/chat')) {
    let price = process.env.X402_PRICE_USDC || '0.01'
    try {
      const cloned = request.clone()
      const body = (await cloned.json().catch(() => null)) as
        | { rateUsdcPer1k?: number; maxTokens?: number; tokenUsage?: number }
        | null
      const rate =
        typeof body?.rateUsdcPer1k === 'number' && Number.isFinite(body.rateUsdcPer1k)
          ? body.rateUsdcPer1k
          : null
      const tokenUsage =
        typeof body?.tokenUsage === 'number' && Number.isFinite(body.tokenUsage)
          ? Math.max(1, Math.round(body.tokenUsage))
          : null
      const maxTokens =
        typeof body?.maxTokens === 'number' && Number.isFinite(body.maxTokens)
          ? Math.max(1, Math.round(body.maxTokens))
          : null
      const billedTokens = tokenUsage ?? maxTokens
      if (rate && billedTokens) {
        const unit = TOKEN_PRICE_UNIT || 100
        const priceUsdc = Math.ceil(billedTokens / unit) * rate
        price = priceUsdc.toFixed(6)
      }
    } catch {
      // fall back to default price
    }

    const chatRoutes = {
      '/api/lmstudio/chat': {
        accepts: [
          {
            scheme: 'exact' as const,
            payTo: PAY_TO as `0x${string}`,
            price,
            network: 'aptos:2' as Network,
          },
        ],
        description: 'Paid LM Studio chat',
        mimeType: 'application/json',
      },
    }

    const chatProxy = paymentProxy(chatRoutes, resourceServer, undefined, undefined, false)
    const response = await chatProxy(request)
    response.headers.set('x-price-usdc', price)
    try {
      const parsed = Number(price)
      if (Number.isFinite(parsed)) {
        response.headers.set('x-price-microusdc', String(Math.round(parsed * 1_000_000)))
      }
    } catch {
      // ignore header conversion errors
    }
    return response
  }
  return NextResponse.next()
}

export const config = { matcher: ['/api/lmstudio/chat'] }
