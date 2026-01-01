import { ANTIGRAVITY_DEFAULT_PROJECT_ID } from '@llmux/auth'

export const ANTIGRAVITY_MODEL_ALIASES: Record<string, string> = {
  'gemini-3-pro-preview': 'gemini-3-pro-high',
  'gemini-claude-sonnet-4-5': 'claude-sonnet-4-5',
  'gemini-claude-sonnet-4-5-thinking': 'claude-sonnet-4-5-thinking',
  'gemini-claude-opus-4-5-thinking': 'claude-opus-4-5-thinking',
}

export function applyAntigravityAlias(model: string): string {
  return ANTIGRAVITY_MODEL_ALIASES[model] || model
}

export interface LicenseErrorContext {
  errorBody: string
  status: number
  currentProject?: string
}

export function isLicenseError(ctx: LicenseErrorContext): boolean {
  if (ctx.status !== 403 && ctx.status !== 400) return false
  return (
    ctx.errorBody.includes('#3501') ||
    (ctx.errorBody.includes('PERMISSION_DENIED') && ctx.errorBody.includes('license'))
  )
}

export function shouldFallbackToDefaultProject(
  ctx: LicenseErrorContext,
  defaultProjectId: string = ANTIGRAVITY_DEFAULT_PROJECT_ID
): boolean {
  return isLicenseError(ctx) && ctx.currentProject !== defaultProjectId
}

export { ANTIGRAVITY_DEFAULT_PROJECT_ID }
