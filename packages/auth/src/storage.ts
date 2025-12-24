import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Credential, ProviderID } from './types'

function getCredentialsPath(): string {
  const home = process.env.HOME || process.env.USERPROFILE || '~'
  return join(home, '.llmux', 'credentials.json')
}

async function ensureDir(path: string): Promise<void> {
  const dir = path.substring(0, path.lastIndexOf('/'))
  await mkdir(dir, { recursive: true })
}

async function readCredentials(): Promise<Record<string, Credential>> {
  try {
    const content = await readFile(getCredentialsPath(), 'utf-8')
    return JSON.parse(content)
  } catch {
    return {}
  }
}

async function writeCredentials(credentials: Record<string, Credential>): Promise<void> {
  const path = getCredentialsPath()
  await ensureDir(path)
  await writeFile(path, JSON.stringify(credentials, null, 2))
}

export namespace CredentialStorage {
  export function getPath(): string {
    return getCredentialsPath()
  }

  export async function get(provider: ProviderID): Promise<Credential | undefined> {
    const credentials = await readCredentials()
    return credentials[provider]
  }

  export async function set(provider: ProviderID, credential: Credential): Promise<void> {
    const credentials = await readCredentials()
    credentials[provider] = credential
    await writeCredentials(credentials)
  }

  export async function remove(provider: ProviderID): Promise<void> {
    const credentials = await readCredentials()
    delete credentials[provider]
    await writeCredentials(credentials)
  }

  export async function all(): Promise<Record<string, Credential>> {
    return readCredentials()
  }
}
