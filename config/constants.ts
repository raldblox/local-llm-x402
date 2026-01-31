export const LM_STUDIO_DEFAULT_BASE_URL =
  (process.env.NEXT_PUBLIC_LM_STUDIO_AGENT_URL ?? 'http://127.0.0.1:4312').trim() ||
  'http://127.0.0.1:4312'
