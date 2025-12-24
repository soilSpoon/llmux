import os from 'node:os'
import { AuthProviderRegistry, CredentialStorage } from '@llmux/auth'
import { cmd } from '../cmd'

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

    console.log(`\nCredentials (${displayPath})\n`)

    const credentials = await CredentialStorage.all()
    const entries = Object.entries(credentials)

    if (entries.length === 0) {
      console.log('  No credentials stored.\n')
      return
    }

    for (const [providerId, credential] of entries) {
      const provider = AuthProviderRegistry.get(providerId)
      const name = provider?.name ?? providerId
      console.log(`  ${name} (${credential.type})`)
    }

    console.log(`\n${entries.length} credential(s)\n`)
  },
})

const authLoginCommand = cmd({
  command: 'login <provider>',
  describe: 'Log in to a provider',
  builder: (yargs) =>
    yargs
      .positional('provider', {
        describe: 'Provider ID (e.g., opencode-zen, github-copilot, antigravity)',
        type: 'string',
        demandOption: true,
      })
      .option('api-key', {
        alias: 'k',
        describe: 'API key (for api type auth)',
        type: 'string',
      }),
  async handler(args) {
    const providerId = args.provider
    const apiKey = args['api-key']

    console.log(`\nLogging in to ${providerId}...\n`)

    const provider = AuthProviderRegistry.get(providerId)

    if (!provider) {
      if (apiKey) {
        await CredentialStorage.set(providerId, {
          type: 'api',
          key: apiKey,
        })
        console.log(`✓ API key stored for ${providerId}\n`)
        return
      }
      console.error(`Error: Provider "${providerId}" not found.`)
      console.error('Use --api-key to store an API key manually.\n')
      process.exit(1)
    }

    if (apiKey) {
      await CredentialStorage.set(providerId, {
        type: 'api',
        key: apiKey,
      })
      console.log(`✓ API key stored for ${providerId}\n`)
      return
    }

    if (provider.methods.length === 0) {
      console.error(`Error: Provider "${providerId}" has no authentication methods.\n`)
      process.exit(1)
    }

    const method = provider.methods[0]
    if (!method) {
      console.error(`Error: Provider "${providerId}" has no authentication methods.\n`)
      process.exit(1)
    }
    console.log(`Using ${method.label} authentication...\n`)

    const result = await method.authorize()

    if (result.type === 'success' && result.credential) {
      await CredentialStorage.set(providerId, result.credential)
      console.log(`✓ Successfully logged in to ${providerId}\n`)
    } else {
      console.error(`✗ Failed to log in: ${result.error ?? 'Unknown error'}\n`)
      process.exit(1)
    }
  },
})

const authLogoutCommand = cmd({
  command: 'logout <provider>',
  describe: 'Log out from a provider',
  builder: (yargs) =>
    yargs.positional('provider', {
      describe: 'Provider ID to log out from',
      type: 'string',
      demandOption: true,
    }),
  async handler(args) {
    const providerId = args.provider

    const credential = await CredentialStorage.get(providerId)
    if (!credential) {
      console.log(`\nNo credential found for ${providerId}\n`)
      return
    }

    await CredentialStorage.remove(providerId)
    console.log(`\n✓ Logged out from ${providerId}\n`)
  },
})
