import { homedir } from 'node:os'

/**
 * Get the user's home directory.
 * Prioritizes environment variables (HOME, USERPROFILE) to support mocking in tests.
 * Falls back to os.homedir().
 */
export function getHomeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || homedir() || '~'
}
