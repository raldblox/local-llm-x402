const { spawn } = require('node:child_process')
const path = require('node:path')

const { startLocalModelAgent, stopLocalModelAgent } = require('../lib/server')

const mode = process.argv[2] === 'start' ? 'start' : 'dev'
const nextArgs =
  mode === 'start'
    ? ['start']
    : ['dev', '--turbopack', ...(process.argv.includes('--no-https') ? [] : [])]

const nextBin = require.resolve('next/dist/bin/next')

async function main() {
  try {
    await startLocalModelAgent()
  } catch (error) {
    console.error('[lm-agent] failed to boot', error)
    process.exit(1)
    return
  }

  const child = spawn(process.execPath, [nextBin, ...nextArgs], {
    stdio: 'inherit',
    env: process.env,
    cwd: path.join(__dirname, '..'),
  })

  const shutdown = async () => {
    await stopLocalModelAgent()
    if (!child.killed) {
      child.kill('SIGTERM')
    }
  }

  process.on('SIGINT', () => {
    shutdown().finally(() => process.exit(0))
  })

  process.on('SIGTERM', () => {
    shutdown().finally(() => process.exit(0))
  })

  child.on('exit', async (code, signal) => {
    await stopLocalModelAgent()
    if (signal) {
      process.kill(process.pid, signal)
      return
    }
    process.exit(code ?? 0)
  })
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
