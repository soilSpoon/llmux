export interface PathParams {
  action?: string
  path?: string
}

/**
 * Extract model name from request URL path or body.
 * Supports:
 * - Path params: /models/{model}:action
 * - Google/Vertex: publishers/google/models/{model}
 * - Body: { model: "..." }
 */
export async function extractModel(
  request: Request,
  pathParams?: PathParams
): Promise<string | null> {
  if (pathParams?.action) {
    const parts = pathParams.action.split(':')
    if (parts.length > 0 && parts[0]) {
      // Handle Google/Vertex model formats like "gemini-3-pro-preview" or "publishers/google/models/gemini-3-pro-preview"
      const modelPart = parts[0]
      // Check if it's a full resource path
      if (modelPart.includes('/models/')) {
        const modelsIdx = modelPart.lastIndexOf('/models/')
        if (modelsIdx >= 0) {
          return modelPart.slice(modelsIdx + 8)
        }
      }
      return modelPart
    }
  }

  if (pathParams?.path) {
    const modelsIdx = pathParams.path.lastIndexOf('models/')
    if (modelsIdx >= 0) {
      const modelPart = pathParams.path.slice(modelsIdx + 7)
      const colonIdx = modelPart.indexOf(':')
      if (colonIdx > 0) {
        return modelPart.slice(0, colonIdx)
      }
      // If no colon, the model name might be the end of the path or followed by /
      const slashIdx = modelPart.indexOf('/')
      if (slashIdx > 0) {
        return modelPart.slice(0, slashIdx)
      }
      return modelPart
    }
  }

  try {
    const clonedRequest = request.clone()
    const text = await clonedRequest.text()
    if (!text) {
      return null
    }

    const body = JSON.parse(text)
    if (typeof body.model === 'string') {
      return body.model
    }
  } catch {
    return null
  }

  return null
}
