import { CredentialStorage } from '@llmux/auth'
import { ConfigLoader, startServer } from '@llmux/server'
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
      })
      .option('hostname', {
        alias: 'H',
        describe: 'Hostname to bind to',
        type: 'string',
      })
      .option('cors', {
        describe: 'Allowed CORS origins (comma-separated)',
        type: 'string',
      })
      .option('no-config', {
        describe: 'Do not load config file',
        type: 'boolean',
        default: false,
      }),
  async handler(args) {
    const loadConfig = !args['no-config']

    let config = ConfigLoader.getDefault()
    if (loadConfig) {
      try {
        config = await ConfigLoader.load()
      } catch {
        // ignore
      }
    }

    const port = args.port ?? config.server.port
    const hostname = args.hostname ?? config.server.hostname
    const corsOrigins =
      args.cors?.split(',').map((s) => s.trim()) ??
      (Array.isArray(config.server.cors) ? config.server.cors : undefined)

    console.log(`\nStarting llmux server...`)
    console.log(`  Hostname: ${hostname}`)
    console.log(`  Port: ${port}`)
    if (corsOrigins) {
      console.log(`  CORS: ${corsOrigins.join(', ')}`)
    }
    if (config.routing.defaultProvider) {
      console.log(`  Default provider: ${config.routing.defaultProvider}`)
    }
    if (config.amp?.enabled) {
      console.log(`  Amp upstream: ${config.amp.upstreamUrl}`)
    }
    console.log()

    // Load credentials to determine enabled providers
    let enabledProviders: string[] | undefined
    try {
      const credentials = await CredentialStorage.all()
      enabledProviders = Object.keys(credentials)
    } catch {
      // ignore
    }

    try {
      const server = await startServer({
        port,
        hostname,
        corsOrigins,
        enabledProviders,
        amp: config.amp?.enabled
          ? {
              handlers: {},
              upstreamUrl: config.amp.upstreamUrl,
              upstreamApiKey: config.amp.upstreamApiKey,
              restrictManagementToLocalhost: config.amp.restrictManagementToLocalhost,
              modelMappings: config.amp.modelMappings,
            }
          : undefined,
      })

      console.log(`✓ Server running at http://${server.hostname}:${server.port}`)
      console.log()
      console.log('Available endpoints:')
      console.log('  GET  /health              - Health check')
      console.log('  GET  /providers           - List providers')
      console.log('  GET  /models              - List models and mappings')
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
