import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'alice-storage-test-'))
const userDataRoot = path.join(testRoot, 'roaming', 'alice-ai-app')
const localDataRoot = path.join(testRoot, 'local')
const targetDataRoot = path.join(testRoot, 'selected-data')
const setPath = vi.fn()

fs.mkdirSync(path.join(userDataRoot, 'user-customization', 'skills'), {
  recursive: true,
})
fs.writeFileSync(
  path.join(userDataRoot, 'user-customization', 'skills', 'SKILL.md'),
  'test skill'
)
fs.writeFileSync(path.join(userDataRoot, 'alice-thoughts.sqlite'), 'database')
fs.mkdirSync(path.join(userDataRoot, 'logs'), { recursive: true })
fs.writeFileSync(path.join(userDataRoot, 'logs', 'main.log'), 'test log')
fs.mkdirSync(path.join(userDataRoot, 'Code Cache'), { recursive: true })
fs.writeFileSync(path.join(userDataRoot, 'Code Cache', 'cache.bin'), 'cache')
fs.writeFileSync(
  path.join(userDataRoot, 'storage-location.json'),
  JSON.stringify({ pendingDataRoot: targetDataRoot })
)

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getPath: (key: string) => (key === 'userData' ? userDataRoot : testRoot),
    setPath,
  },
  dialog: {
    showOpenDialog: vi.fn(),
  },
  shell: {
    openPath: vi.fn(),
  },
}))

let storage: typeof import('../../electron/main/storagePaths')
let previousLocalAppData: string | undefined

describe('storage paths', () => {
  beforeAll(async () => {
    previousLocalAppData = process.env.LOCALAPPDATA
    process.env.LOCALAPPDATA = localDataRoot
    storage = await import('../../electron/main/storagePaths')
  })

  afterAll(() => {
    if (previousLocalAppData === undefined) delete process.env.LOCALAPPDATA
    else process.env.LOCALAPPDATA = previousLocalAppData
    fs.rmSync(testRoot, { recursive: true, force: true })
  })

  it('migrates managed data before exposing the selected root', () => {
    expect(storage.getDataRoot()).toBe(targetDataRoot)
    expect(
      fs.readFileSync(
        path.join(targetDataRoot, 'user-customization', 'skills', 'SKILL.md'),
        'utf8'
      )
    ).toBe('test skill')
    expect(
      fs.readFileSync(
        path.join(targetDataRoot, 'alice-thoughts.sqlite'),
        'utf8'
      )
    ).toBe('database')
    expect(fs.existsSync(path.join(userDataRoot, 'user-customization'))).toBe(
      false
    )
    expect(
      fs.existsSync(path.join(userDataRoot, 'alice-thoughts.sqlite'))
    ).toBe(false)
  })

  it('moves session data to the local cache root', () => {
    expect(setPath).toHaveBeenCalledWith(
      'sessionData',
      path.join(localDataRoot, 'alice-ai-app', 'session-data')
    )
  })

  it('reports the diagnostics log directory and its size', () => {
    const snapshot = storage.getStorageSnapshot()
    expect(snapshot.logsRoot).toBe(path.join(userDataRoot, 'logs'))
    expect(snapshot.logBytes).toBe(Buffer.byteLength('test log'))
  })

  it('reports and clears legacy cache files without touching data', () => {
    expect(storage.getStorageSnapshot().legacyCacheBytes).toBeGreaterThan(0)
    expect(storage.clearLegacyCaches().clearedBytes).toBeGreaterThan(0)
    expect(fs.existsSync(path.join(userDataRoot, 'Code Cache'))).toBe(false)
    expect(
      fs.existsSync(path.join(targetDataRoot, 'alice-thoughts.sqlite'))
    ).toBe(true)
  })
})
