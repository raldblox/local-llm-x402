import { paymentProxy } from '@rvk_rishikesh/next'
import { x402ResourceServer, HTTPFacilitatorClient } from '@rvk_rishikesh/core/server'
import { ExactAptosScheme } from '@rvk_rishikesh/aptos/exact/server'
import type { Network } from '@rvk_rishikesh/core/types'
import { NextRequest, NextResponse } from 'next/server'

const ENABLE_X402 = process.env.ENABLE_X402 === 'true'
const FACILITATOR_URL = process.env.FACILITATOR_URL || 'https://x402-navy.vercel.app/facilitator/'
const PAY_TO = process.env.PAYMENT_RECIPIENT_ADDRESS || '0x840ae5d03ad922e93fd2f6c17a55435bf0bdfebd8846ff8d5d3a362cc6b890b4'
const PRICE_USDC = process.env.X402_PRICE_USDC || '0.01'

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

const roomRoutes = {
  '/api/room/message': {
    accepts: [
      {
        scheme: 'exact' as const,
        payTo: PAY_TO as `0x${string}`,
        price: PRICE_USDC,
        network: 'aptos:2' as Network,
      },
    ],
    description: 'Paid chat message',
    mimeType: 'application/json',
  },
}

const roomProxy = paymentProxy(roomRoutes, resourceServer, undefined, undefined, false)

export async function middleware(request: NextRequest) {
  if (!ENABLE_X402) {
    return NextResponse.next()
  }

  const path = request.nextUrl.pathname
  if (path.startsWith('/api/room/message')) {
    return roomProxy(request)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/api/room/message'],
}
