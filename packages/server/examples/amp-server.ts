/**
 * Amp-Compatible Server Example
 *
 * This example demonstrates how to set up an llmux server with Amp CLI compatibility.
 * It uses local API keys when available and falls back to ampcode.com when needed.
 *
 * Usage:
 *   # Set environment variables
 *   export OPENAI_API_KEY=sk-...
 *   export ANTHROPIC_API_KEY=sk-ant-...
 *   export GOOGLE_API_KEY=...
 *   export AMP_API_KEY=...  # Optional: for upstream fallback
 *
 *   # Run the server
 *   bun run examples/amp-server.ts
 *
 *   # Configure Amp CLI to use this server
 *   amp config set api.url http://localhost:8743
 */

import { startServer, type AmpConfig } from '../src/server'
import type { ProviderHandlers } from '../src/amp/routes'
import type { ProviderChecker } from '../src/handlers/fallback'

// Define which models are available locally (based on API keys)
function createProviderChecker(): ProviderChecker {
  const availableModels = new Set<string>()

  // OpenAI models (if API key is set)
  if (process.env.OPENAI_API_KEY) {
    availableModels.add('gpt-4o')
    availableModels.add('gpt-4o-mini')
    availableModels.add('gpt-4-turbo')
    availableModels.add('gpt-3.5-turbo')
  }

  // Anthropic models (if API key is set)
  if (process.env.ANTHROPIC_API_KEY) {
    availableModels.add('claude-sonnet-4-20250514')
    availableModels.add('claude-3-5-sonnet-20241022')
    availableModels.add('claude-3-haiku-20240307')
    availableModels.add('claude-3-opus-20240229')
  }

  // Gemini models (if API key is set)
  if (process.env.GOOGLE_API_KEY) {
    availableModels.add('gemini-2.0-flash')
    availableModels.add('gemini-1.5-pro')
    availableModels.add('gemini-1.5-flash')
  }

  console.log(`Available local models: ${[...availableModels].join(', ') || '(none)'}`)

  return (model: string) => availableModels.has(model)
}

// Create provider handlers
function createProviderHandlers(): ProviderHandlers {
  const handlers: ProviderHandlers = {}

  // OpenAI handler
  if (process.env.OPENAI_API_KEY) {
    handlers.openai = async (request: Request) => {
      const body = await request.text()

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body,
      })

      return new Response(response.body, {
        status: response.status,
        headers: response.headers,
      })
    }
    console.log('✓ OpenAI handler configured')
  }

  // Anthropic handler
  if (process.env.ANTHROPIC_API_KEY) {
    handlers.anthropic = async (request: Request) => {
      const body = await request.text()

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY!,
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
        },
        body,
      })

      return new Response(response.body, {
        status: response.status,
        headers: response.headers,
      })
    }
    console.log('✓ Anthropic handler configured')
  }

  // Gemini handler
  if (process.env.GOOGLE_API_KEY) {
    handlers.google = async (request: Request, params) => {
      const body = await request.text()
      const action = params?.action ?? 'gemini-pro:generateContent'
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${action}?key=${process.env.GOOGLE_API_KEY}`

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body,
      })

      return new Response(response.body, {
        status: response.status,
        headers: response.headers,
      })
    }
    console.log('✓ Gemini handler configured')
  }

  return handlers
}

async function main() {
  const port = parseInt(process.env.PORT ?? '8743', 10)
  const handlers = createProviderHandlers()
  const providerChecker = createProviderChecker()

  const ampConfig: AmpConfig = {
    handlers,
    providerChecker,
    // Configure upstream fallback (optional)
    upstreamUrl: process.env.AMP_UPSTREAM_URL ?? 'https://api.ampcode.com',
    upstreamApiKey: process.env.AMP_API_KEY,
  }

  // Only enable upstream if API key is provided
  if (!process.env.AMP_API_KEY) {
    console.log('⚠ AMP_API_KEY not set - upstream fallback disabled')
    ampConfig.upstreamUrl = undefined
  } else {
    console.log('✓ Upstream fallback configured (ampcode.com)')
  }

  const server = await startServer({
    port,
    hostname: '0.0.0.0',
    corsOrigins: ['*'],
    amp: ampConfig,
  })

  console.log(`
╔══════════════════════════════════════════════════════╗
║              Amp-Compatible Server                   ║
╠══════════════════════════════════════════════════════╣
║  Server running on: http://localhost:${server.port.toString().padEnd(14)}║
║                                                      ║
║  Endpoints:                                          ║
║    /api/provider/:provider/v1/chat/completions       ║
║    /api/provider/:provider/v1/messages               ║
║    /api/provider/:provider/v1/models                 ║
║    /v1beta/models/*action                            ║
║    /health                                           ║
║                                                      ║
║  Configure Amp CLI:                                  ║
║    amp config set api.url http://localhost:${server.port.toString().padEnd(8)}║
╚══════════════════════════════════════════════════════╝
  `)

  // Handle shutdown
  process.on('SIGINT', async () => {
    console.log('\nShutting down...')
    await server.stop()
    process.exit(0)
  })
}

main().catch(console.error)
