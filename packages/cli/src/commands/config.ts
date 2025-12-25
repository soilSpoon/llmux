import os from 'node:os'
import * as prompts from '@clack/prompts'
import { ConfigLoader, type LlmuxConfig, type ModelMapping } from '@llmux/server'
import { cmd } from '../cmd'

const dim = (text: string) => `\x1b[2m${text}\x1b[22m`

export const configCommand = cmd({
  command: 'config',
  describe: 'Manage configuration',
  builder: (yargs) =>
    yargs
      .command(configListCommand)
      .command(configGetCommand)
      .command(configSetCommand)
      .demandCommand(1, 'You need to specify a subcommand'),
  handler() {},
})

const configListCommand = cmd({
  command: 'list',
  aliases: ['ls'],
  describe: 'Show current configuration',
  async handler() {
    const configPath = ConfigLoader.getPath()
    const homedir = os.homedir()
    const displayPath = configPath.startsWith(homedir)
      ? configPath.replace(homedir, '~')
      : configPath

    console.log()
    prompts.intro(`Configuration ${dim(displayPath)}`)

    const config = await ConfigLoader.load()

    prompts.log.info('Server:')
    console.log(`  port: ${config.server.port}`)
    console.log(`  hostname: ${config.server.hostname}`)
    console.log(
      `  cors: ${Array.isArray(config.server.cors) ? config.server.cors.join(', ') : config.server.cors}`
    )

    prompts.log.info('Routing:')
    console.log(`  defaultProvider: ${config.routing.defaultProvider ?? 'none'}`)
    console.log(`  fallbackOrder: ${config.routing.fallbackOrder?.join(', ') ?? 'none'}`)
    console.log(`  rotateOn429: ${config.routing.rotateOn429 ?? false}`)

    if (config.routing.modelMapping) {
      console.log('  modelMapping:')
      for (const [model, mapping] of Object.entries(config.routing.modelMapping)) {
        const m = mapping as ModelMapping
        console.log(`    ${model}: ${m.provider}/${m.model}`)
      }
    }

    prompts.outro('Done')
  },
})

const configGetCommand = cmd({
  command: 'get <key>',
  describe: 'Get a configuration value',
  builder: (yargs) =>
    yargs.positional('key', {
      describe: 'Configuration key (e.g., server.port, routing.defaultProvider)',
      type: 'string',
      demandOption: true,
    }),
  async handler(args) {
    const key = args.key as string
    const config = await ConfigLoader.load()

    const parts = key.split('.')
    let value: unknown = config

    for (const part of parts) {
      if (value && typeof value === 'object' && part in value) {
        value = (value as Record<string, unknown>)[part]
      } else {
        console.log(`Key not found: ${key}`)
        process.exit(1)
      }
    }

    if (typeof value === 'object') {
      console.log(JSON.stringify(value, null, 2))
    } else {
      console.log(value)
    }
  },
})

const configSetCommand = cmd({
  command: 'set <key> <value>',
  describe: 'Set a configuration value',
  builder: (yargs) =>
    yargs
      .positional('key', {
        describe: 'Configuration key (e.g., server.port, routing.defaultProvider)',
        type: 'string',
        demandOption: true,
      })
      .positional('value', {
        describe: 'Value to set',
        type: 'string',
        demandOption: true,
      }),
  async handler(args) {
    const key = args.key as string
    const rawValue = args.value as string

    console.log()
    prompts.intro('Update configuration')

    const config = await ConfigLoader.load()
    const parts = key.split('.')

    if (parts.length !== 2) {
      prompts.log.error('Key must be in format: section.field (e.g., server.port)')
      prompts.outro('Failed')
      process.exit(1)
    }

    const [section, field] = parts as [keyof LlmuxConfig, string]

    if (!(String(section) in config)) {
      prompts.log.error(`Unknown section: ${String(section)}`)
      prompts.outro('Failed')
      process.exit(1)
    }

    let parsedValue: unknown = rawValue

    if (rawValue === 'true') parsedValue = true
    else if (rawValue === 'false') parsedValue = false
    else if (/^\d+$/.test(rawValue)) parsedValue = parseInt(rawValue, 10)
    else if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
      parsedValue = rawValue
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim())
    }

    const sectionConfig = config[section] as Record<string, unknown>
    sectionConfig[field] = parsedValue

    await ConfigLoader.save(config)

    prompts.log.success(`Set ${key} = ${rawValue}`)
    prompts.outro('Done')
  },
})
