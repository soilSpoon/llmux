import { handleStreamingProxy, type ProxyOptions } from '@llmux/server'
import { cmd } from '../cmd'

export const streamCommand = cmd({
  command: 'stream',
  describe: 'Proxy a streaming request',
  builder: (yargs) =>
    yargs
      .option('from', {
        alias: 'f',
        describe: 'Source format (openai, anthropic, gemini)',
        type: 'string',
        default: 'openai',
      })
      .option('to', {
        alias: 't',
        describe: 'Target provider (openai, anthropic, gemini)',
        type: 'string',
        demandOption: true,
      })
      .option('model', {
        alias: 'm',
        describe: 'Target model',
        type: 'string',
      })
      .option('api-key', {
        alias: 'k',
        describe: 'API key for target provider',
        type: 'string',
      })
      .option('input', {
        alias: 'i',
        describe: 'Input JSON file path (reads from stdin if not provided)',
        type: 'string',
      }),
  async handler(args) {
    const sourceFormat = args.from as 'openai' | 'anthropic' | 'gemini'
    const targetProvider = args.to
    const targetModel = args.model
    const apiKey = args['api-key']
    const inputFile = args.input

    let body: string

    if (inputFile) {
      const file = Bun.file(inputFile)
      body = await file.text()
    } else {
      const chunks: Buffer[] = []
      for await (const chunk of process.stdin) {
        chunks.push(chunk)
      }
      body = Buffer.concat(chunks).toString('utf-8')
    }

    if (!body.trim()) {
      console.error('Error: No input provided. Use --input or pipe JSON to stdin.')
      process.exit(1)
    }

    const request = new Request('http://localhost/v1/proxy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body,
    })

    const options: ProxyOptions = {
      sourceFormat,
      targetProvider,
      targetModel,
      apiKey,
    }

    try {
      const response = await handleStreamingProxy(request, options)

      if (!response.body) {
        console.error('Error: No response body')
        process.exit(1)
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        process.stdout.write(decoder.decode(value, { stream: true }))
      }

      console.log()
    } catch (error) {
      console.error('Stream error:', error)
      process.exit(1)
    }
  },
})
