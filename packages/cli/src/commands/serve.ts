import { startServer } from '@llmux/server'
import { cmd } from '../cmd'

export const serveCommand = cmd({
  command: 'serve',
  describe: 'Start the proxy server',
  builder: (yargs) =>
    yargs
      .option('port', {
        alias: 'p',
        describe: 'Port to listen on',
        type: 'number',
        default: 8080,
      })
      .option('hostname', {
        alias: 'H',
        describe: 'Hostname to bind to',
        type: 'string',
        default: 'localhost',
      })
      .option('cors', {
        describe: 'Allowed CORS origins (comma-separated)',
        type: 'string',
      }),
  async handler(args) {
    const port = args.port
    const hostname = args.hostname
    const corsOrigins = args.cors?.split(',').map((s) => s.trim())

    console.log(`\nStarting llmux server...`)
    console.log(`  Hostname: ${hostname}`)
    console.log(`  Port: ${port}`)
    if (corsOrigins) {
      console.log(`  CORS: ${corsOrigins.join(', ')}`)
    }
    console.log()

    try {
      const server = await startServer({
        port,
        hostname,
        corsOrigins,
      })

      console.log(`✓ Server running at http://${server.hostname}:${server.port}`)
      console.log()
      console.log('Available endpoints:')
      console.log('  GET  /health              - Health check')
      console.log('  GET  /providers           - List providers')
      console.log('  POST /v1/chat/completions - OpenAI-compatible endpoint')
      console.log('  POST /v1/messages         - Anthropic-compatible endpoint')
      console.log('  POST /v1/generateContent  - Gemini-compatible endpoint')
      console.log('  POST /v1/proxy            - Explicit proxy endpoint')
      console.log()
      console.log('Press Ctrl+C to stop.\n')

      process.on('SIGINT', async () => {
        console.log('\nShutting down...')
        await server.stop()
        process.exit(0)
      })

      process.on('SIGTERM', async () => {
        await server.stop()
        process.exit(0)
      })

      await new Promise(() => {})
    } catch (error) {
      console.error('Failed to start server:', error)
      process.exit(1)
    }
  },
})
