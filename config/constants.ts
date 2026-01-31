export const LM_STUDIO_DEFAULT_BASE_URL =
  (
    process.env.NEXT_PUBLIC_LM_STUDIO_AGENT_URL ??
    process.env.NEXT_PUBLIC_LM_STUDIO_BASE_URL ??
    process.env.NEXT_PUBLIC_LM_STUDIO_URL ??
    process.env.LM_STUDIO_AGENT_URL ??
    process.env.LM_STUDIO_BASE_URL ??
    'http://127.0.0.1:1234'
  ).trim() || 'http://127.0.0.1:1234'

export const DEFAULT_RATE_USDC_PER_1K = 0.001
export const DEFAULT_GUEST_BALANCE_SEED = 100_000_000
export const TOKEN_PRICE_UNIT = 100
