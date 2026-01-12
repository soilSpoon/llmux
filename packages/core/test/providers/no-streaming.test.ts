import { describe, it } from 'bun:test'
import { readFile } from 'fs/promises'
import { join } from 'path'

describe('Provider Interface Cleanliness', () => {
  it('Provider interface should NOT have streaming methods', async () => {
    const baseProviderPath = join(import.meta.dir, '../../src/providers/base.ts')
    const content = await readFile(baseProviderPath, 'utf-8')
    
    // Check for parseStreamChunk definition
    const hasParseStreamChunk = /parseStreamChunk\?\(chunk: string\)/.test(content)
    
    // Check for transformStreamChunk definition
    const hasTransformStreamChunk = /transformStreamChunk\?\(chunk: StreamChunk\)/.test(content)
    
    if (hasParseStreamChunk || hasTransformStreamChunk) {
      throw new Error('Provider interface still has streaming methods')
    }
  })
})
