import path from 'node:path'
import fs from 'node:fs/promises'
import type {
  CustomAvatar,
  CustomAvatarsSnapshot,
  AvatarStateVideos,
} from '../../types/customAvatars'
import { getCustomizationRoot as getStorageCustomizationRoot } from './storagePaths'

const CUSTOM_AVATARS_DIR_NAME = 'custom-avatars'
const REQUIRED_FILES: Array<{
  key: 'speaking' | 'thinking' | 'standby'
  file: string
}> = [
  { key: 'speaking', file: 'speaking.mp4' },
  { key: 'thinking', file: 'thinking.mp4' },
  { key: 'standby', file: 'standby.mp4' },
]
const AVATAR_PROTOCOL = 'alice-avatar://'
const BUILTIN_AVATAR_ID = 'alice'
const BUILTIN_OVERRIDE_FOLDER = '__builtin__'
const CHAT_AVATAR_BASENAME = 'chat-avatar'
const MAX_CHAT_AVATAR_BYTES = 6 * 1024 * 1024
const CHAT_AVATAR_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'] as const

function getCustomizationRoot(): string {
  return getStorageCustomizationRoot()
}

function getAvatarsRoot(): string {
  return path.join(getCustomizationRoot(), CUSTOM_AVATARS_DIR_NAME)
}

async function ensureDirectoryExists(dirPath: string) {
  await fs.mkdir(dirPath, { recursive: true })
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

function createAvatarId(folderName: string): string {
  const safeName = folderName.trim() || 'custom-avatar'
  return `custom:${safeName}`
}

function createAvatarProtocolUrl(folderName: string, fileName: string): string {
  const relativePath = path.join(folderName, fileName).replace(/\\/g, '/')
  return `${AVATAR_PROTOCOL}${encodeURIComponent(relativePath)}`
}

async function findChatAvatar(
  folderName: string,
  folderPath: string
): Promise<string | undefined> {
  for (const extension of CHAT_AVATAR_EXTENSIONS) {
    const fileName = `${CHAT_AVATAR_BASENAME}${extension}`
    const filePath = path.join(folderPath, fileName)
    if (await fileExists(filePath)) {
      const fileStat = await fs.stat(filePath)
      return `${createAvatarProtocolUrl(folderName, fileName)}?v=${Math.trunc(fileStat.mtimeMs)}`
    }
  }
  return undefined
}

function resolveAvatarFolder(avatarId: string): {
  folderName: string
  folderPath: string
} {
  const folderName =
    avatarId === BUILTIN_AVATAR_ID
      ? BUILTIN_OVERRIDE_FOLDER
      : avatarId.startsWith('custom:')
        ? avatarId.slice('custom:'.length)
        : ''
  if (
    !folderName ||
    folderName === '.' ||
    folderName === '..' ||
    path.basename(folderName) !== folderName ||
    folderName.includes('/') ||
    folderName.includes('\\')
  ) {
    throw new Error('Invalid avatar identifier.')
  }

  const avatarsRoot = path.resolve(getAvatarsRoot())
  const folderPath = path.resolve(avatarsRoot, folderName)
  if (!folderPath.startsWith(`${avatarsRoot}${path.sep}`)) {
    throw new Error('Avatar folder is outside the customization directory.')
  }
  return { folderName, folderPath }
}

function detectChatAvatarExtension(
  bytes: Uint8Array
): '.png' | '.jpg' | '.webp' {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return '.png'
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return '.jpg'
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  ) {
    return '.webp'
  }
  throw new Error('Chat avatar must be a PNG, JPEG, or WebP image.')
}

export async function loadCustomAvatarsFromDisk(): Promise<CustomAvatarsSnapshot> {
  const customizationRoot = getCustomizationRoot()
  const avatarsRoot = getAvatarsRoot()
  await ensureDirectoryExists(avatarsRoot)

  const entries = await fs.readdir(avatarsRoot, { withFileTypes: true })
  const avatars: CustomAvatar[] = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const folderName = entry.name
    const avatarFolderAbsolute = path.join(avatarsRoot, folderName)

    const stateVideos: AvatarStateVideos = {} as AvatarStateVideos
    let missingRequired = false
    for (const requirement of REQUIRED_FILES) {
      const candidatePath = path.join(avatarFolderAbsolute, requirement.file)
      if (!(await fileExists(candidatePath))) {
        missingRequired = true
        break
      }
      stateVideos[requirement.key] = createAvatarProtocolUrl(
        folderName,
        requirement.file
      )
    }

    if (missingRequired) {
      continue
    }

    const avatar: CustomAvatar = {
      id: createAvatarId(folderName),
      name: folderName,
      folderName,
      source: 'custom',
      stateVideos,
      previewVideo: stateVideos.standby,
      chatAvatar: await findChatAvatar(folderName, avatarFolderAbsolute),
    }
    avatars.push(avatar)
  }

  const builtinOverridePath = path.join(avatarsRoot, BUILTIN_OVERRIDE_FOLDER)
  return {
    avatars,
    customizationRoot: avatarsRoot,
    builtinChatAvatar: await findChatAvatar(
      BUILTIN_OVERRIDE_FOLDER,
      builtinOverridePath
    ),
  }
}

export async function setAvatarChatImage(
  avatarId: string,
  imageBytes: Uint8Array
): Promise<CustomAvatarsSnapshot> {
  if (!imageBytes.length || imageBytes.length > MAX_CHAT_AVATAR_BYTES) {
    throw new Error('Chat avatar must be smaller than 6 MB.')
  }
  const extension = detectChatAvatarExtension(imageBytes)
  const { folderPath } = resolveAvatarFolder(avatarId)
  await ensureDirectoryExists(folderPath)

  for (const oldExtension of CHAT_AVATAR_EXTENSIONS) {
    const oldPath = path.join(
      folderPath,
      `${CHAT_AVATAR_BASENAME}${oldExtension}`
    )
    if (await fileExists(oldPath)) await fs.unlink(oldPath)
  }
  await fs.writeFile(
    path.join(folderPath, `${CHAT_AVATAR_BASENAME}${extension}`),
    imageBytes
  )
  return loadCustomAvatarsFromDisk()
}

export async function refreshCustomAvatars(): Promise<CustomAvatarsSnapshot> {
  return loadCustomAvatarsFromDisk()
}

export function getCustomAvatarsRootPath(): string {
  return getAvatarsRoot()
}
