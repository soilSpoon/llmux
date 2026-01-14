import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// CRITICAL: Globally redirect HOME to a temporary directory for ALL tests.
// This prevents tests from ever touching the real ~/.llmux or other production config files.
const testHome = mkdtempSync(join(tmpdir(), 'llmux-global-test-home-'))
process.env.HOME = testHome
process.env.USERPROFILE = testHome // For Windows compatibility

console.log(`[Global Setup] HOME redirected to: ${testHome}`)
