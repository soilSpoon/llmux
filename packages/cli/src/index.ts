#!/usr/bin/env bun
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import { authCommand } from './commands/auth'
import { proxyCommand } from './commands/proxy'
import { serveCommand } from './commands/serve'
import { streamCommand } from './commands/stream'

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

await cli.parse()
