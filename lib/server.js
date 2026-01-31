/* eslint-disable @typescript-eslint/no-require-imports */
const Fastify = require('fastify')
const cors = require('@fastify/cors')
const { LM_STUDIO_DEFAULT_TARGET_URL } = require('./constants')
const DEFAULT_TARGET =
  (process.env.LM_AGENT_TARGET ?? LM_STUDIO_DEFAULT_TARGET_URL).trim() || LM_STUDIO_DEFAULT_TARGET_URL
const PORT = Number.parseInt(process.env.LM_AGENT_PORT ?? '4312', 10)
const HOST = (process.env.LM_AGENT_HOST ?? '127.0.0.1').trim() || '127.0.0.1'
let instancePromise

const normalizeBaseUrl = (input) => {
  const trimmed = (input ?? DEFAULT_TARGET).trim()

  if (!trimmed) {
    return DEFAULT_TARGET
  }

  return trimmed.replace(/\/+$/, '')
}

const resolveTarget = (overrides = []) => {
  for (const override of overrides) {
    if (typeof override === 'string' && override.trim().length > 0) {
      return normalizeBaseUrl(override)
    }
  }

  return normalizeBaseUrl(DEFAULT_TARGET)
}

const createAgentServer = async () => {
  const fastify = Fastify({
    logger: {
      level: process.env.LM_AGENT_LOGGER ?? 'error',
    },
  })

  await fastify.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'OPTIONS'],
  })

  fastify.get('/health', async (request, reply) => {
    const target = resolveTarget([request.query?.target])

    reply.send({
      ok: true,
      target,
    })
  })

  const forwardHeaders = (request) => {
    const headers = {
      Accept: 'application/json',
    }
    const auth = request.headers?.authorization
    if (auth) {
      headers.Authorization = auth
    }
    return headers
  }

  const handleModels = async (request, reply) => {
    const target = resolveTarget([request.query?.target])

    try {
      const response = await fetch(`${target}/v1/models`, {
        headers: forwardHeaders(request),
        cache: 'no-store',
      })

      if (!response.ok) {
        reply.status(response.status === 404 ? 404 : 502).send({ error: `LM Studio responded with ${response.status}` })

        return
      }

      const payload = await response.json()

      reply.send(payload)
    } catch (error) {
      reply.status(502).send({
        error: error?.message ?? 'Failed to reach LM Studio',
      })
    }
  }

  fastify.get('/v1/models', handleModels)

  const handleChat = async (request, reply) => {
    const overrides = [
      typeof request.body?.baseUrl === 'string' ? request.body.baseUrl : undefined,
      typeof request.body?.target === 'string' ? request.body.target : undefined,
    ]
    const target = resolveTarget(overrides)
    const payload = request.body && typeof request.body === 'object' ? { ...request.body } : {}

    delete payload.baseUrl
    delete payload.target

    try {
      const endpoint = `${target}/v1/chat/completions`
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...forwardHeaders(request),
        },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        reply.status(response.status === 404 ? 404 : 502).send({
          error: `LM Studio responded with ${response.status}`,
        })

        return
      }

      const data = await response.json()

      reply.send(data)
    } catch (error) {
      reply.status(502).send({
        error: error?.message ?? 'Failed to reach LM Studio',
      })
    }
  }

  fastify.post('/v1/chat/completions', (request, reply) => handleChat(request, reply))

  await fastify.listen({ host: HOST, port: PORT })

  fastify.log.info(`local model agent listening on http://${HOST}:${PORT} -> ${DEFAULT_TARGET}`)

  return fastify
}

async function startLocalModelAgent() {
  if (!process.env.START_LM_AGENT && process.env.NODE_ENV === 'production' && process.env.VERCEL) {
    // prevent serverless environments from trying to open localhost listener
    return null
  }

  if (!instancePromise) {
    instancePromise = createAgentServer().catch((error) => {
      instancePromise = undefined
      throw error
    })
  }

  return instancePromise
}

async function stopLocalModelAgent() {
  if (!instancePromise) {
    return
  }

  try {
    const instance = await instancePromise

    if (instance) {
      await instance.close()
    }
  } catch {
    // ignore shutdown failures
  } finally {
    instancePromise = undefined
  }
}

module.exports = {
  startLocalModelAgent,
  stopLocalModelAgent,
}
