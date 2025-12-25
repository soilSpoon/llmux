#!/usr/bin/env bun
import {
  AntigravityProvider,
  AuthProviderRegistry,
  GithubCopilotProvider,
  OpencodeZenProvider,
} from '@llmux/auth'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import { authCommand } from './commands/auth'
import { proxyCommand } from './commands/proxy'
import { serveCommand } from './commands/serve'
import { streamCommand } from './commands/stream'
import { CancelledError } from './errors'

// Register auth providers
AuthProviderRegistry.register(OpencodeZenProvider)
AuthProviderRegistry.register(GithubCopilotProvider)
AuthProviderRegistry.register(AntigravityProvider)

const cli = yargs(hideBin(process.argv))
  .scriptName('llmux')
  .usage('$0 <command> [options]')
  .command(authCommand)
  .command(serveCommand)
  .command(proxyCommand)
  .command(streamCommand)
  .demandCommand(1, 'You need to specify a command')
  .help()
  .alias('h', 'help')
  .version()
  .alias('v', 'version')
  .strict()
  .fail((msg, err, yargs) => {
    if (err instanceof CancelledError) {
      process.exit(0)
    }
    if (msg) {
      console.log(yargs.help())
      console.log()
      console.error(msg)
      process.exit(1)
    }
    if (err) {
      throw err
    }
  })

await cli.parse()
