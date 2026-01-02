import { createLogger } from '../../util/logger'
import type { GeminiContent, GeminiPart } from '../gemini/types'

const logger = createLogger({ service: 'antigravity-pairing-fix' })

/**
 * Fixes tool response grouping in Gemini content history.
 *
 * Ensures that:
 * 1. Every tool response has a matching tool call in the history.
 * 2. Tool responses are grouped correctly after their calls.
 * 3. Orphan responses (responses without calls) are recovered by finding or creating calls.
 * 4. Responses are placed in the correct order.
 *
 * Ported/Adapted from opencode-antigravity-auth/src/plugin/request-helpers.ts
 */
export function fixAntigravityToolPairing(contents: GeminiContent[]): GeminiContent[] {
  if (!Array.isArray(contents) || contents.length === 0) {
    return contents
  }

  const newContents: GeminiContent[] = []

  // Track pending tool call groups that need responses
  // A group is a set of tool calls from a single 'model' turn
  const pendingGroups: Array<{
    ids: string[]
    funcNames: string[]
    insertAfterIdx: number
  }> = []

  // Collected orphan responses (by ID) to be matched
  const collectedResponses = new Map<string, GeminiPart>()

  for (const content of contents) {
    const role = content.role
    const parts = content.parts || []

    // Check if this is a tool response message (user role, has functionResponse)
    const responseParts = parts.filter((p) => p.functionResponse)

    if (responseParts.length > 0) {
      // Collect responses by ID (skip duplicates)
      for (const resp of responseParts) {
        const respId = resp.functionResponse?.id || ''
        if (respId && !collectedResponses.has(respId)) {
          collectedResponses.set(respId, resp)
        }
      }

      // Try to satisfy the most recent pending group
      for (let i = pendingGroups.length - 1; i >= 0; i--) {
        const group = pendingGroups[i]
        // Check if we have all responses needed for this group
        if (group && group.ids.every((id) => collectedResponses.has(id))) {
          // All IDs found - build the response group
          const groupResponses = group.ids.map((id) => {
            const resp = collectedResponses.get(id)
            collectedResponses.delete(id)
            return resp as GeminiPart
          })

          newContents.push({
            role: 'user',
            parts: groupResponses,
          })

          pendingGroups.splice(i, 1)
          break // Only satisfy one group at a time
        }
      }
      continue // Don't add the original response message (we reconstruct it)
    }

    if (role === 'model') {
      // Check for function calls in this model message
      const funcCalls = parts.filter((p) => p.functionCall)
      newContents.push(content)

      if (funcCalls.length > 0) {
        const callIds = funcCalls.map((fc) => fc.functionCall?.id || '').filter(Boolean)
        const funcNames = funcCalls.map((fc) => fc.functionCall?.name || '')

        if (callIds.length > 0) {
          pendingGroups.push({
            ids: callIds,
            funcNames,
            insertAfterIdx: newContents.length - 1,
          })
        }
      }
    } else {
      // Regular user message or system message
      newContents.push(content)
    }
  }

  // Handle remaining pending groups with orphan recovery
  // Process in reverse order so insertions don't shift indices (though splice injects so order matters)
  // Actually, we are inserting into newContents which is already built.
  // We need to be careful about insertAfterIdx being valid in newContents.
  // insertAfterIdx refers to index in newContents because we push to newContents as we go.

  // Sort by index descending to handle insertions from end to start effectively (though matched groups were already removed)
  pendingGroups.sort((a, b) => b.insertAfterIdx - a.insertAfterIdx)

  for (const group of pendingGroups) {
    const groupResponses: GeminiPart[] = []

    for (let i = 0; i < group.ids.length; i++) {
      const expectedId = group.ids[i] || ''
      const expectedName = group.funcNames[i] || ''

      if (collectedResponses.has(expectedId)) {
        // Direct ID match - ideal case
        groupResponses.push(collectedResponses.get(expectedId) as GeminiPart)
        collectedResponses.delete(expectedId)
      } else if (collectedResponses.size > 0) {
        // Need to find an orphan response to repurpose
        let matchedId: string | null = null

        // Pass 1: Match by function name
        for (const [orphanId, orphanResp] of collectedResponses) {
          const orphanName = orphanResp.functionResponse?.name || ''
          if (orphanName === expectedName) {
            matchedId = orphanId
            break
          }
        }

        // Pass 2: Take first available (last resort)
        if (!matchedId) {
          matchedId = collectedResponses.keys().next().value ?? null
        }

        if (matchedId) {
          const orphanResp = collectedResponses.get(matchedId)
          if (!orphanResp) continue // Should not happen given matchedId comes from keys

          collectedResponses.delete(matchedId)

          // Fix the ID and name to match expected
          if (orphanResp.functionResponse) {
            orphanResp.functionResponse.id = expectedId
            // If known name mismatch, update it? Or keep original?
            // Reference implementation updates name if original was 'unknown_function'
            // We can just trust expectedName as explicit truth
            orphanResp.functionResponse.name = expectedName
          }

          logger.debug(
            {
              mappedFrom: matchedId,
              mappedTo: expectedId,
              functionName: expectedName,
            },
            'Auto-repaired tool ID mismatch'
          )

          groupResponses.push(orphanResp)
        }
      } else {
        // No responses available - create placeholder
        const placeholder: GeminiPart = {
          functionResponse: {
            name: expectedName || 'unknown_function',
            response: {
              result: {
                error:
                  'Tool response was lost during context processing. This is a recovered placeholder.',
                recovered: true,
              },
            },
            id: expectedId,
          },
        }

        logger.debug(
          {
            id: expectedId,
            name: expectedName,
          },
          'Created placeholder response for missing tool'
        )

        groupResponses.push(placeholder)
      }
    }

    if (groupResponses.length > 0) {
      // Insert at correct position (after the model message that made the calls)
      // insertAfterIdx is the index of the model message
      newContents.splice(group.insertAfterIdx + 1, 0, {
        role: 'user',
        parts: groupResponses,
      })
    }
  }

  return newContents
}
