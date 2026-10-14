import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const electronState = vi.hoisted(() => ({ userDataRoot: '' }))

vi.mock('electron', () => ({
  app: {
    getPath: () => electronState.userDataRoot,
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`encrypted:${value}`),
    decryptString: (value: Buffer) => {
      const text = value.toString('utf8')
      if (!text.startsWith('encrypted:')) {
        throw new Error('Error while decrypting the ciphertext provided')
      }
      return text.slice('encrypted:'.length)
    },
  },
}))

let settingsManager: typeof import('../../electron/main/settingsManager')
let testRoot = ''

describe('settings manager protected-secret recovery', () => {
  beforeAll(async () => {
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'alice-settings-test-'))
    electronState.userDataRoot = testRoot
    fs.writeFileSync(
      path.join(testRoot, 'alice-settings.json'),
      JSON.stringify({
        aiProvider: 'custom',
        customBaseUrl: 'https://example.test/v1',
        assistantModel: 'test-model',
      })
    )
    fs.writeFileSync(path.join(testRoot, 'alice-secrets.bin'), 'unreadable')
    settingsManager = await import('../../electron/main/settingsManager')
  })

  afterAll(() => {
    fs.rmSync(testRoot, { recursive: true, force: true })
  })

  it('keeps public settings and backs up an unreadable secret file when new credentials are saved', async () => {
    const loaded = await settingsManager.loadSettings()
    expect(loaded).toMatchObject({
      aiProvider: 'custom',
      customBaseUrl: 'https://example.test/v1',
      assistantModel: 'test-model',
    })

    await settingsManager.saveSettings({
      ...loaded,
      VITE_CUSTOM_API_KEY: 'replacement-key',
    })

    const backupName = fs
      .readdirSync(testRoot)
      .find(name => name.startsWith('alice-secrets.bin.unreadable-'))
    expect(backupName).toBeTruthy()
    expect(fs.readFileSync(path.join(testRoot, backupName!), 'utf8')).toBe(
      'unreadable'
    )

    const reloaded = await settingsManager.loadSettings()
    expect(reloaded?.VITE_CUSTOM_API_KEY).toBe('replacement-key')
  })
})
