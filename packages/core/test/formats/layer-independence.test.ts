import { describe, it } from 'bun:test'
import { readdir, readFile } from 'fs/promises'
import { join } from 'path'

describe('Format Layer Independence', () => {
  it('formats should not import from providers', async () => {
    const formatsDir = join(import.meta.dir, '../../src/formats')
    const files = await readdir(formatsDir, { recursive: true })
    
    for (const file of files) {
      if (!file.endsWith('.ts')) continue
      
      // Skip streaming-pipeline files as they are currently being migrated (known violation to be fixed later)
      // Actually T007 fixes this, so for now we might see failures if we check everything.
      // But T001 identified anthropic-messages.ts imports streaming pipeline from provider.
      // Let's verify that ONLY that one fails or if we fixed it? We didn't fix anthropic-messages.ts yet.
      
      const content = await readFile(join(formatsDir, file), 'utf-8')
      const hasProviderImport = /from ['"]\.\.\/providers\//.test(content) || /from ['"]\.\.\/\.\.\/providers\//.test(content)
      
      if (hasProviderImport) {
        throw new Error(`File ${file} imports from providers layer`)
      }
    }
  })
})
