import fs from 'node:fs'
export function debugLog(msg: string) {
  fs.appendFileSync('/tmp/llmux-debug.log', `${msg}\n`)
}
