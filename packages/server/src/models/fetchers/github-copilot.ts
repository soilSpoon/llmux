import type { Model, ModelFetcher } from '../types'

export const GITHUB_COPILOT_API_URL = 'https://api.githubcopilot.com'

interface CopilotModelsResponse {
  object: 'list'
  data: Array<{
    id: string
    name?: string
    created?: number
    context_length?: number
    max_completion_tokens?: number
  }>
}

function buildCopilotHeaders(accessToken: string): Headers {
  const headers = new Headers()
  headers.set('Content-Type', 'application/json')
  headers.set('Authorization', `Bearer ${accessToken}`)
  headers.set('Editor-Version', 'vscode/1.85.0')
  headers.set('Editor-Plugin-Version', 'copilot/1.155.0')
  headers.set('User-Agent', 'GithubCopilot/1.155.0')
  headers.set('Accept', 'application/json')
  return headers
}

export function createGithubCopilotFetcher(): ModelFetcher {
  return {
    async fetchModels(accessToken?: string): Promise<Model[]> {
      if (!accessToken) {
        return []
      }

      try {
        const response = await fetch(`${GITHUB_COPILOT_API_URL}/models`, {
          method: 'GET',
          headers: buildCopilotHeaders(accessToken),
        })

        if (!response.ok) {
          return []
        }

        const json = (await response.json()) as CopilotModelsResponse

        if (!json.data || !Array.isArray(json.data)) {
          return []
        }

        return json.data.map((m) => ({
          id: m.id,
          provider: 'github-copilot' as const,
          name: m.name || m.id,
          object: 'model' as const,
          created: m.created,
          context_length: m.context_length,
          max_completion_tokens: m.max_completion_tokens,
          owned_by: 'github',
        }))
      } catch {
        return []
      }
    },
  }
}
