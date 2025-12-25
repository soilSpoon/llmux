import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { ConfigLoader, type LlmuxConfig } from '../src/config'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('ConfigLoader', () => {
  let tempDir: string
  let originalHome: string | undefined

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'llmux-config-test-'))
    originalHome = process.env.HOME
    process.env.HOME = tempDir
  })

  afterEach(async () => {
    process.env.HOME = originalHome
    await rm(tempDir, { recursive: true, force: true })
  })

  test('getPath returns correct path', () => {
    const path = ConfigLoader.getPath()
    expect(path).toBe(join(tempDir, '.llmux', 'config.yaml'))
  })

  test('load returns default config when no file exists', async () => {
    const config = await ConfigLoader.load()
    expect(config.server.port).toBe(8743)
    expect(config.server.hostname).toBe('localhost')
    expect(config.routing.defaultProvider).toBe('anthropic')
  })

  test('getDefault returns default configuration', () => {
    const config = ConfigLoader.getDefault()
    expect(config.server.port).toBe(8743)
    expect(config.server.cors).toBe(true)
    expect(config.routing.rotateOn429).toBe(true)
  })

  test('save and load config', async () => {
    const config: LlmuxConfig = {
      server: {
        port: 3000,
        hostname: '0.0.0.0',
        cors: ['http://localhost:3000'],
      },
      routing: {
        defaultProvider: 'openai',
        fallbackOrder: ['openai', 'anthropic'],
        rotateOn429: false,
      },
    }

    await ConfigLoader.save(config)
    const loaded = await ConfigLoader.load()

    expect(loaded.server.port).toBe(3000)
    expect(loaded.server.hostname).toBe('0.0.0.0')
    expect(loaded.routing.defaultProvider).toBe('openai')
    expect(loaded.routing.rotateOn429).toBe(false)
  })

  test('get returns specific section', async () => {
    const server = await ConfigLoader.get('server')
    expect(server.port).toBe(8743)
  })

  test('set updates specific section', async () => {
    await ConfigLoader.set('server', {
      port: 9999,
      hostname: 'example.com',
      cors: false,
    })

    const config = await ConfigLoader.load()
    expect(config.server.port).toBe(9999)
    expect(config.server.hostname).toBe('example.com')
  })

  test('load merges with default for missing fields', async () => {
    const dir = join(tempDir, '.llmux')
    await rm(dir, { recursive: true, force: true })
    await mkdir(dir, { recursive: true })
    await writeFile(
      join(dir, 'config.yaml'),
      `server:
  port: 5000
`
    )

    const config = await ConfigLoader.load()
    expect(config.server.port).toBe(5000)
    expect(config.server.hostname).toBe('localhost')
    expect(config.routing.defaultProvider).toBe('anthropic')
  })

  test('parses YAML with model mapping', async () => {
    const dir = join(tempDir, '.llmux')
    await mkdir(dir, { recursive: true })
    await writeFile(
      join(dir, 'config.yaml'),
      `server:
  port: 8743
  hostname: localhost
  cors: true

routing:
  defaultProvider: anthropic
  fallbackOrder: [anthropic, openai, gemini]
  rotateOn429: true
`
    )

    const config = await ConfigLoader.load()
    expect(config.routing.defaultProvider).toBe('anthropic')
    expect(config.routing.rotateOn429).toBe(true)
  })
})
