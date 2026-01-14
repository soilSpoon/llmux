import type { MetadataInjectionStrategy, RequestMetadataInjection } from '@llmux/core'

export class AntigravityMetadataStrategy implements MetadataInjectionStrategy {
  readonly strategyType = 'metadata'

  requiresInjection(_model: string): boolean {
    return true
  }

  getMetadata(options: {
    model: string
    projectId?: string
    requestId?: string
  }): RequestMetadataInjection {
    const { model, projectId, requestId } = options
    return {
      project: projectId,
      model,
      requestId,
    }
  }
}
