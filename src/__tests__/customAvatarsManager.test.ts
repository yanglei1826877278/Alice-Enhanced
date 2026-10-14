import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from 'vitest'
import path from 'node:path'
import fs from 'node:fs/promises'
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import os from 'node:os'

const testRoot = mkdtempSync(path.join(os.tmpdir(), 'alice-custom-avatars-'))
const userDataDir = path.join(testRoot, 'user-data')
mkdirSync(userDataDir, { recursive: true })
let cwdSpy: any = null

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: (key: string) => (key === 'userData' ? userDataDir : testRoot),
  },
}))

import {
  loadCustomAvatarsFromDisk,
  getCustomAvatarsRootPath,
  setAvatarChatImage,
} from '../../electron/main/customAvatarsManager'

const customizationRoot = path.join(testRoot, 'user-customization')
const avatarsRoot = path.join(customizationRoot, 'custom-avatars')

async function resetCustomizationDir() {
  await fs.rm(customizationRoot, { recursive: true, force: true })
}

describe('customAvatarsManager', () => {
  beforeAll(async () => {
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(testRoot)
    await resetCustomizationDir()
  })

  afterAll(() => {
    cwdSpy?.mockRestore()
    rmSync(testRoot, { recursive: true, force: true })
  })

  beforeEach(async () => {
    await resetCustomizationDir()
  })

  it('initializes customization folder and returns empty avatars list', async () => {
    const snapshot = await loadCustomAvatarsFromDisk()
    expect(snapshot.avatars).toHaveLength(0)
    const stat = await fs.stat(avatarsRoot)
    expect(stat.isDirectory()).toBe(true)
    expect(getCustomAvatarsRootPath()).toBe(avatarsRoot)
  })

  it('includes only folders with all required videos', async () => {
    await fs.mkdir(path.join(avatarsRoot, 'GalaxyAlice'), { recursive: true })
    await fs.writeFile(
      path.join(avatarsRoot, 'GalaxyAlice', 'speaking.mp4'),
      'speaking'
    )
    await fs.writeFile(
      path.join(avatarsRoot, 'GalaxyAlice', 'thinking.mp4'),
      'thinking'
    )
    await fs.writeFile(
      path.join(avatarsRoot, 'GalaxyAlice', 'standby.mp4'),
      'standby'
    )

    await fs.mkdir(path.join(avatarsRoot, 'Incomplete'), { recursive: true })
    await fs.writeFile(
      path.join(avatarsRoot, 'Incomplete', 'standby.mp4'),
      'only-one'
    )

    const snapshot = await loadCustomAvatarsFromDisk()
    expect(snapshot.avatars).toHaveLength(1)
    const avatar = snapshot.avatars[0]
    expect(avatar.name).toBe('GalaxyAlice')
    expect(avatar.id).toBe('custom:GalaxyAlice')
    expect(avatar.stateVideos.speaking.startsWith('alice-avatar://')).toBe(true)
    const decodedPath = decodeURIComponent(
      avatar.stateVideos.thinking.replace('alice-avatar://', '')
    )
    expect(decodedPath.endsWith('GalaxyAlice/thinking.mp4')).toBe(true)
  })

  it('stores a role-specific chat avatar and rejects unsafe avatar ids', async () => {
    const avatarFolder = path.join(avatarsRoot, 'GalaxyAlice')
    await fs.mkdir(avatarFolder, { recursive: true })
    await Promise.all(
      ['speaking.mp4', 'thinking.mp4', 'standby.mp4'].map(fileName =>
        fs.writeFile(path.join(avatarFolder, fileName), fileName)
      )
    )

    const pngHeader = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ])
    const snapshot = await setAvatarChatImage(
      'custom:GalaxyAlice',
      pngHeader
    )

    expect(snapshot.avatars[0].chatAvatar).toContain(
      'GalaxyAlice%2Fchat-avatar.png'
    )
    await expect(
      setAvatarChatImage('custom:../escape', pngHeader)
    ).rejects.toThrow('Invalid avatar identifier')
  })
})
