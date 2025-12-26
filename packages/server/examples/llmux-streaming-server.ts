/**
 * llmux Streaming Server Example
 *
 * This is a minimal llmux server for testing streaming with multiple AI SDKs.
 * It supports:
 * - @ai-sdk/openai (POST /v1/chat/completions)
 * - @ai-sdk/anthropic (POST /v1/messages)
 * - @ai-sdk/google (POST /v1/generateContent)
 * - Format auto-detection (POST /v1/auto)
 *
 * Usage:
 *   cd llmux/packages/server
 *   bun run examples/llmux-streaming-server.ts
 */

import { startServer } from '../src/server'

async function main() {
  const port = parseInt(process.env.PORT ?? '8743', 10)

  const server = await startServer({
    port,
    hostname: 'localhost',
  })

  console.log(`
╔════════════════════════════════════════════════════════╗
║             llmux Streaming Server                     ║
╠════════════════════════════════════════════════════════╣
║  Server running on: http://localhost:${port}                    ║
║                                                        ║
║  Endpoints:                                            ║
║    POST /v1/chat/completions   (OpenAI SDK)           ║
║    POST /v1/messages           (Anthropic SDK)        ║
║    POST /v1/generateContent    (Gemini SDK)           ║
║    POST /v1/auto               (Auto-detect)          ║
║    POST /v1/responses          (Responses API)        ║
║    GET  /health                (Health check)         ║
║    GET  /models                (List models)          ║
║    GET  /providers             (List providers)       ║
║                                                        ║
║  Usage:                                                ║
║    - Set X-Target-Provider header to route to         ║
║      a specific provider (e.g., 'antigravity')        ║
║    - Server auto-detects format from request body     ║
║    - Streaming works with all endpoints               ║
╚════════════════════════════════════════════════════════╝
  `)

  // Handle shutdown
  process.on('SIGINT', async () => {
    console.log('\nShutting down...')
    await server.stop()
    process.exit(0)
  })
}

main().catch(console.error)
