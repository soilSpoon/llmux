import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Credential, ProviderID } from './types'
import { isApiKeyCredential, isOAuthCredential } from './types'

function getCredentialsPath(): string {
  const home = process.env.HOME || process.env.USERPROFILE || '~'
  return join(home, '.llmux', 'credentials.json')
}

async function ensureDir(path: string): Promise<void> {
  const dir = path.substring(0, path.lastIndexOf('/'))
  await mkdir(dir, { recursive: true })
}

async function readCredentials(): Promise<Record<string, Credential[]>> {
  try {
    const content = await readFile(getCredentialsPath(), 'utf-8')
    const data = JSON.parse(content)
    // Normalize legacy data to array
    for (const key in data) {
      if (!Array.isArray(data[key])) {
        data[key] = [data[key]]
      }
    }
    return data
  } catch {
    return {}
  }
}

async function writeCredentials(credentials: Record<string, Credential[]>): Promise<void> {
  const path = getCredentialsPath()
  await ensureDir(path)
  await writeFile(path, JSON.stringify(credentials, null, 2))
}

export namespace CredentialStorage {
  export function getPath(): string {
    return getCredentialsPath()
  }

  export async function get(provider: ProviderID): Promise<Credential[]> {
    const credentials = await readCredentials()
    return credentials[provider] || []
  }

  export async function add(provider: ProviderID, credential: Credential): Promise<void> {
    const credentials = await readCredentials()
    if (!credentials[provider]) {
      credentials[provider] = []
    }

    // Check if essentially the same credential exists
    const index = credentials[provider].findIndex((c) => {
      if (isApiKeyCredential(c) && isApiKeyCredential(credential)) return c.key === credential.key
      if (isOAuthCredential(c) && isOAuthCredential(credential)) {
        return (c.email && c.email === credential.email) || c.accessToken === credential.accessToken
      }
      return false
    })

    if (index !== -1) {
      // Update existing
      credentials[provider][index] = credential
    } else {
      credentials[provider].push(credential)
    }
    await writeCredentials(credentials)
  }

  export async function update(provider: ProviderID, credential: Credential): Promise<void> {
    return add(provider, credential)
  }

  export async function set(provider: ProviderID, credential: Credential): Promise<void> {
    return add(provider, credential)
  }

  export async function remove(provider: ProviderID): Promise<void> {
    const credentials = await readCredentials()
    delete credentials[provider]
    await writeCredentials(credentials)
  }

  export async function all(): Promise<Record<string, Credential[]>> {
    return readCredentials()
  }
}
