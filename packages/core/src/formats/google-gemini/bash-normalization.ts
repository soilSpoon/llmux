/**
 * Bash tool argument normalization for Antigravity provider.
 *
 * Gemini models (via Antigravity) often return `cmd` or `code` instead of
 * `command` for the Bash tool. This module provides utilities to normalize
 * these arguments so clients receive the expected `command` field.
 */

/**
 * Normalize Bash tool call arguments.
 *
 * If the tool name is "Bash" (case-insensitive) and the arguments contain
 * `cmd` or `code` but not `command`, this copies the value to `command`.
 *
 * @param toolName The name of the tool being called
 * @param args The arguments object for the tool call
 * @returns Normalized arguments object with `command` field populated if applicable
 */
export function normalizeBashArguments(
  toolName: string,
  args: Record<string, unknown>
): Record<string, unknown> {
  // Only normalize for Bash tool
  if (toolName.toLowerCase() !== 'bash') {
    return args
  }

  // If command already exists, no normalization needed
  if ('command' in args && args.command !== undefined) {
    return args
  }

  // Create a copy to avoid mutating the original
  const normalized = { ...args }

  // Check for alternative field names and copy to command
  if ('cmd' in args && args.cmd !== undefined) {
    normalized.command = args.cmd
  } else if ('code' in args && args.code !== undefined) {
    normalized.command = args.code
  }

  return normalized
}
