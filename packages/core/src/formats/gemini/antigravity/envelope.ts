import { randomUUID } from 'node:crypto'
import type { AntigravityProviderRequest, AntigravityProviderRequestPayload } from './types.js'

export interface EnvelopeOptions {
  model: string
  project?: string
  location?: string
  userAgent?: string
  requestId?: string
  metadata?: AntigravityProviderRequest['metadata']
}

export function buildAntigravityEnvelope(
  payload: AntigravityProviderRequestPayload,
  options: EnvelopeOptions
): AntigravityProviderRequest {
  if (!options.project) {
    throw new Error('Project ID is required for Antigravity envelope')
  }

  return {
    project: options.project,
    location: options.location,
    model: options.model,
    request: payload,
    userAgent: options.userAgent,
    requestId: options.requestId || randomUUID(),
  }
}
