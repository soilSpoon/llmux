import os from 'node:os'
import * as prompts from '@clack/prompts'
import {
  type AuthMethod,
  AuthProviderRegistry,
  type AuthStep,
  type Credential,
  CredentialStorage,
} from '@llmux/auth'
import { cmd } from '../cmd'
import { CancelledError } from '../errors'

const dim = (text: string) => `\x1b[2m${text}\x1b[22m`

const KNOWN_PROVIDERS = [
  { id: 'anthropic', name: 'Anthropic', hint: 'Claude API' },
  { id: 'openai', name: 'OpenAI', hint: 'GPT API' },
] as const

async function handleAuth(providerId: string, method: AuthMethod) {
  let result: AuthStep

  if (method.type === 'api') {
    const input = await prompts.password({
      message: 'Enter your API key',
      validate: (v) => (v && v.length > 0 ? undefined : 'Required'),
    })
    if (prompts.isCancel(input)) throw new CancelledError()
    result = await method.authorize({ key: input })
  } else {
    const spinner = prompts.spinner()
    spinner.start('Authorizing...')
    result = await method.authorize()
    spinner.stop()
  }

  if (result.type === 'intermediate') {
    if (result.url) {
      prompts.log.info(`Go to: ${result.url}`)
    }

    if (result.auto) {
      const spinner = prompts.spinner()
      spinner.start(result.message || 'Waiting for authorization...')
      result = await result.callback()
      spinner.stop()
    } else {
      const code = await prompts.text({
        message: result.message || 'Paste the authorization code:',
        validate: (v) => (v && v.length > 0 ? undefined : 'Required'),
      })
      if (prompts.isCancel(code)) throw new CancelledError()

      const spinner = prompts.spinner()
      spinner.start('Verifying...')
      result = await result.callback(code)
      spinner.stop()
    }
  }

  if (result.type === 'success' && result.credential) {
    // Add to storage (appends if exists)
    await CredentialStorage.add(providerId, result.credential)
    const provider = AuthProviderRegistry.get(providerId)
    const name = provider?.name ?? providerId
    prompts.log.success(`Logged in to ${name}`)
    prompts.outro('Done')
  } else {
    const error = result.type === 'failed' ? result.error : 'Unknown error'
    prompts.log.error(`Failed: ${error}`)
    prompts.outro('Failed')
    process.exit(1)
  }
}

export const authCommand = cmd({
  command: 'auth',
  describe: 'Manage credentials',
  builder: (yargs) =>
    yargs
      .command(authLoginCommand)
      .command(authLogoutCommand)
      .command(authListCommand)
      .demandCommand(1, 'You need to specify a subcommand'),
  handler() {},
})

const authListCommand = cmd({
  command: 'list',
  aliases: ['ls'],
  describe: 'List stored credentials',
  async handler() {
    const credPath = CredentialStorage.getPath()
    const homedir = os.homedir()
    const displayPath = credPath.startsWith(homedir) ? credPath.replace(homedir, '~') : credPath

    console.log()
    prompts.intro(`Credentials ${dim(displayPath)}`)

    const credentials = await CredentialStorage.all()
    const entries = Object.entries(credentials)

    if (entries.length === 0) {
      prompts.log.warn('No credentials stored.')
      prompts.outro('0 credentials')
      return
    }

    for (const [providerId, creds] of entries as [string, Credential[]][]) {
      const provider = AuthProviderRegistry.get(providerId)
      const name = provider?.name ?? providerId
      // Display count
      prompts.log.info(`${name} ${dim(`(${creds.length} active)`)}`)
    }

    prompts.outro(`${entries.length} providers configured`)
  },
})

const authLoginCommand = cmd({
  command: 'login [provider]',
  describe: 'Log in to a provider',
  builder: (yargs) =>
    yargs
      .positional('provider', {
        describe: 'Provider ID (e.g., openai, anthropic, github-copilot)',
        type: 'string',
      })
      .option('api-key', {
        alias: 'k',
        describe: 'API key (for api type auth)',
        type: 'string',
      }),
  async handler(args) {
    let providerId: string | undefined = args.provider
    const apiKey = args['api-key']

    console.log()
    prompts.intro('Add credential')

    if (!providerId) {
      const registeredProviders = AuthProviderRegistry.list()
      const registeredIds = new Set(registeredProviders.map((p) => p.id))

      const allOptions = [
        ...registeredProviders.map((p) => ({
          label: p.name,
          value: p.id,
          hint: p.methods.length > 0 ? p.methods[0]?.label : 'API key',
        })),
        ...KNOWN_PROVIDERS.filter((p) => !registeredIds.has(p.id)).map((p) => ({
          label: p.name,
          value: p.id,
          hint: p.hint,
        })),
        { label: 'Other', value: '_other_', hint: 'Enter custom provider ID' },
      ]

      const selected = await prompts.select({
        message: 'Select provider',
        options: allOptions,
      })
      if (prompts.isCancel(selected)) throw new CancelledError()

      if (selected === '_other_') {
        const input = await prompts.text({
          message: 'Enter provider ID',
          placeholder: 'e.g., openai, anthropic',
          validate: (v) => (v && v.length > 0 ? undefined : 'Required'),
        })
        if (prompts.isCancel(input)) throw new CancelledError()
        providerId = input as string
      } else {
        providerId = selected as string
      }
    }

    const provider = AuthProviderRegistry.get(providerId)

    if (!provider) {
      let key = apiKey
      if (!key) {
        const input = await prompts.password({
          message: 'Enter your API key',
          validate: (v) => (v && v.length > 0 ? undefined : 'Required'),
        })
        if (prompts.isCancel(input)) throw new CancelledError()
        key = input
      }

      await CredentialStorage.add(providerId, {
        type: 'api',
        key,
      })
      prompts.log.success(`API key stored for ${providerId}`)
      prompts.outro('Done')
      return
    }

    if (apiKey) {
      await CredentialStorage.add(providerId, {
        type: 'api',
        key: apiKey,
      })
      prompts.log.success(`API key stored for ${providerId}`)
      prompts.outro('Done')
      return
    }

    const providerHelpMessages: Record<string, string> = {
      'opencode-zen': 'Create an API key at https://opencode.ai/auth',
      antigravity: 'Get Google API key from https://makersuite.google.com/app/apikey',
      'github-copilot': 'You will be redirected to GitHub to authorize',
    }

    if (provider.methods.length === 0) {
      const helpMessage = providerId ? providerHelpMessages[providerId] : undefined
      if (helpMessage) {
        prompts.log.info(helpMessage)
      }

      const input = await prompts.password({
        message: 'Enter your API key',
        validate: (v) => (v && v.length > 0 ? undefined : 'Required'),
      })
      if (prompts.isCancel(input)) throw new CancelledError()

      await CredentialStorage.add(providerId, {
        type: 'api',
        key: input,
      })
      prompts.log.success(`API key stored for ${provider.name}`)
      prompts.outro('Done')
      return
    }

    if (provider.methods.length === 1) {
      const method = provider.methods[0]
      if (!method) {
        return
      }

      const helpMessage = providerId ? providerHelpMessages[providerId] : undefined
      if (helpMessage && method.type === 'api') {
        prompts.log.info(helpMessage)
      }

      prompts.log.info(`Using ${method.label} authentication...`)
      await handleAuth(providerId, method)
      return
    }

    let methodIndex = 0
    if (provider.methods.length > 1) {
      const selected = await prompts.select({
        message: 'Select login method',
        options: provider.methods.map((m: { label: string }, i: number) => ({
          label: m.label,
          value: i.toString(),
        })),
      })
      if (prompts.isCancel(selected)) throw new CancelledError()
      methodIndex = parseInt(selected as string, 10)
    }

    const method = provider.methods[methodIndex]
    if (!method) {
      prompts.log.error(`No authentication method found.`)
      prompts.outro('Failed')
      process.exit(1)
    }

    const helpMessage = providerId ? providerHelpMessages[providerId] : undefined
    if (helpMessage && method.type === 'api') {
      prompts.log.info(helpMessage)
    }

    prompts.log.info(`Using ${method.label} authentication...`)
    await handleAuth(providerId, method)
  },
})

const authLogoutCommand = cmd({
  command: 'logout [provider]',
  describe: 'Log out from a provider (removes all accounts)',
  builder: (yargs) =>
    yargs.positional('provider', {
      describe: 'Provider ID to log out from',
      type: 'string',
    }),
  async handler(args) {
    let providerId: string | undefined = args.provider

    console.log()
    prompts.intro('Remove credential')

    const credentials = await CredentialStorage.all()
    const entries = Object.entries(credentials)

    if (entries.length === 0) {
      prompts.log.warn('No credentials found')
      prompts.outro('Done')
      return
    }

    if (!providerId) {
      const selected = await prompts.select({
        message: 'Select provider to log out',
        options: (entries as [string, Credential[]][]).map(([id, creds]) => {
          const provider = AuthProviderRegistry.get(id)
          const name = provider?.name ?? id
          return {
            label: `${name} ${dim(`(${creds.length} active)`)}`,
            value: id,
          }
        }),
      })
      if (prompts.isCancel(selected)) throw new CancelledError()
      providerId = selected as string
    }

    const current = await CredentialStorage.get(providerId)
    if (!current || current.length === 0) {
      prompts.log.warn(`No credential found for ${providerId}`)
      prompts.outro('Done')
      return
    }

    await CredentialStorage.remove(providerId)
    prompts.log.success(`Logged out all accounts from ${providerId}`)
    prompts.outro('Done')
  },
})
