import type { AdbCredentialStore, AdbPrivateKey } from '@yume-chan/adb'

const STORAGE_KEY = 'quest-library::adb-private-keys'

interface StoredCredential {
  buffer: string
  name?: string
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = ''

  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return btoa(binary)
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return bytes
}

function loadKeys(): AdbPrivateKey[] {
  const raw = localStorage.getItem(STORAGE_KEY)

  if (!raw) {
    return []
  }

  try {
    const parsed = JSON.parse(raw) as StoredCredential[]
    return parsed.map((entry) => ({
      buffer: decodeBase64(entry.buffer),
      name: entry.name,
    }))
  } catch {
    localStorage.removeItem(STORAGE_KEY)
    return []
  }
}

function saveKeys(keys: AdbPrivateKey[]): void {
  const payload: StoredCredential[] = keys.map((entry) => ({
    buffer: encodeBase64(entry.buffer),
    name: entry.name,
  }))

  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
}

async function generatePrivateKey(): Promise<AdbPrivateKey> {
  const generated = (await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-1',
    },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair

  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', generated.privateKey))

  return {
    buffer: pkcs8,
    name: `quest-library-${new Date().toISOString()}`,
  }
}

export const browserCredentialStore: AdbCredentialStore = {
  async generateKey() {
    const nextKey = await generatePrivateKey()
    const storedKeys = loadKeys()
    storedKeys.push(nextKey)
    saveKeys(storedKeys)
    return nextKey
  },
  *iterateKeys() {
    const storedKeys = loadKeys()

    for (const key of storedKeys) {
      yield key
    }
  },
}
