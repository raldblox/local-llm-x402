const LM_STUDIO_PROXY_BASE_URL =
  (process.env.LM_STUDIO_PROXY_BASE_URL ?? 'http://127.0.0.1:4312').trim() ||
  'http://127.0.0.1:4312'

const LM_STUDIO_DEFAULT_TARGET_URL =
  (process.env.LM_STUDIO_DEFAULT_TARGET_URL ?? 'http://127.0.0.1:1234').trim() ||
  'http://127.0.0.1:1234'

module.exports = {
  LM_STUDIO_PROXY_BASE_URL,
  LM_STUDIO_DEFAULT_TARGET_URL,
}
