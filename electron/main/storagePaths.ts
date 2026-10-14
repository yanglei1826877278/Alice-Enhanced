import { app, dialog, shell } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const STORAGE_CONFIG_FILE = 'storage-location.json'
const APP_DIRECTORY_NAME = 'alice-ai-app'
const SESSION_DIRECTORY_NAME = 'session-data'

const MANAGED_DATA_ENTRIES = [
  'user-customization',
  'components',
  'codex-home',
  'generated_images',
  'alice-rag.sqlite',
  'alice-rag.sqlite-shm',
  'alice-rag.sqlite-wal',
  'alice-rag-hnsw-local.index',
  'alice-rag-hnsw-local.meta.json',
  'alice-thoughts.sqlite',
  'alice-thoughts.sqlite-shm',
  'alice-thoughts.sqlite-wal',
  'alice-thoughts-hnsw-openai.index',
  'alice-thoughts-hnsw-local.index',
  'alice-memories.json',
] as const

const LEGACY_CACHE_ENTRIES = [
  'Cache',
  'Code Cache',
  'GPUCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'blob_storage',
] as const

const PERSISTENT_SESSION_ENTRIES = [
  'Dictionaries',
  'Local Storage',
  'Network',
  'Preferences',
  'Session Storage',
  'Shared Dictionary',
] as const

interface StorageLocationConfig {
  dataRoot?: string
  pendingDataRoot?: string
  cleanupRoot?: string
}

export interface StorageSnapshot {
  configRoot: string
  cacheRoot: string
  dataRoot: string
  logsRoot: string
  defaultDataRoot: string
  legacyCacheBytes: number
  dataBytes: number
  logBytes: number
  restartRequired: boolean
  pendingDataRoot?: string
}

let initialized = false
let configRoot = ''
let storageConfigPath = ''
let defaultDataRoot = ''
let cacheRoot = ''
let dataRoot = ''
let storageConfig: StorageLocationConfig = {}

function getPlatformLocalRoot(): string {
  if (process.platform === 'win32') {
    return (
      process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
    )
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support')
  }
  return process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share')
}

function getPlatformCacheRoot(): string {
  if (process.platform === 'win32') {
    return (
      process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
    )
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Caches')
  }
  return process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache')
}

function readStorageConfig(): StorageLocationConfig {
  try {
    const parsed = JSON.parse(fs.readFileSync(storageConfigPath, 'utf8'))
    return {
      dataRoot:
        typeof parsed?.dataRoot === 'string' && parsed.dataRoot.trim()
          ? path.resolve(parsed.dataRoot)
          : undefined,
      pendingDataRoot:
        typeof parsed?.pendingDataRoot === 'string' &&
        parsed.pendingDataRoot.trim()
          ? path.resolve(parsed.pendingDataRoot)
          : undefined,
      cleanupRoot:
        typeof parsed?.cleanupRoot === 'string' && parsed.cleanupRoot.trim()
          ? path.resolve(parsed.cleanupRoot)
          : undefined,
    }
  } catch {
    return {}
  }
}

function writeStorageConfig(config: StorageLocationConfig): void {
  fs.mkdirSync(configRoot, { recursive: true })
  const temporaryPath = `${storageConfigPath}.tmp`
  fs.writeFileSync(temporaryPath, JSON.stringify(config, null, 2), 'utf8')
  fs.rmSync(storageConfigPath, { force: true })
  fs.renameSync(temporaryPath, storageConfigPath)
}

function isPathInside(parentPath: string, childPath: string): boolean {
  const relative = path.relative(parentPath, childPath)
  return (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  )
}

function assertSafeMigrationTarget(
  currentRoot: string,
  targetRoot: string
): void {
  if (path.resolve(currentRoot) === path.resolve(targetRoot)) return
  if (
    isPathInside(currentRoot, targetRoot) ||
    isPathInside(targetRoot, currentRoot)
  ) {
    throw new Error(
      'The new data directory cannot contain the current directory or be inside it.'
    )
  }
}

function migrateManagedData(currentRoot: string, targetRoot: string): void {
  assertSafeMigrationTarget(currentRoot, targetRoot)
  fs.mkdirSync(targetRoot, { recursive: true })

  const copiedEntries: string[] = []
  for (const entry of MANAGED_DATA_ENTRIES) {
    const sourcePath = path.join(currentRoot, entry)
    if (!fs.existsSync(sourcePath)) continue
    const targetPath = path.join(targetRoot, entry)
    fs.cpSync(sourcePath, targetPath, {
      recursive: true,
      force: true,
      preserveTimestamps: true,
    })
    copiedEntries.push(entry)
  }

  writeStorageConfig({ dataRoot: targetRoot, cleanupRoot: currentRoot })
  if (cleanupManagedData(currentRoot, copiedEntries)) {
    writeStorageConfig({ dataRoot: targetRoot })
  }
}

function cleanupManagedData(
  rootPath: string,
  entries: readonly string[] = MANAGED_DATA_ENTRIES
): boolean {
  let success = true
  for (const entry of entries) {
    try {
      fs.rmSync(path.join(rootPath, entry), { recursive: true, force: true })
    } catch (error) {
      success = false
      console.warn(
        `[Storage] Could not remove migrated source ${entry}:`,
        error
      )
    }
  }
  return success
}

export function initializeStoragePaths(): void {
  if (initialized) return

  configRoot = app.getPath('userData')
  storageConfigPath = path.join(configRoot, STORAGE_CONFIG_FILE)
  defaultDataRoot = path.join(
    getPlatformLocalRoot(),
    APP_DIRECTORY_NAME,
    'data'
  )
  cacheRoot = path.join(getPlatformCacheRoot(), APP_DIRECTORY_NAME)
  storageConfig = readStorageConfig()
  dataRoot = storageConfig.dataRoot || configRoot

  if (
    storageConfig.cleanupRoot &&
    path.resolve(storageConfig.cleanupRoot) !== path.resolve(dataRoot) &&
    cleanupManagedData(storageConfig.cleanupRoot)
  ) {
    writeStorageConfig({ dataRoot })
    storageConfig = { dataRoot }
  }

  if (storageConfig.pendingDataRoot) {
    try {
      const pendingRoot = path.resolve(storageConfig.pendingDataRoot)
      migrateManagedData(dataRoot, pendingRoot)
      dataRoot = pendingRoot
      storageConfig = readStorageConfig()
      console.log(`[Storage] Data migration completed: ${pendingRoot}`)
    } catch (error) {
      console.error(
        '[Storage] Data migration failed; continuing with the previous directory:',
        error
      )
    }
  }

  fs.mkdirSync(dataRoot, { recursive: true })
  if (app.isPackaged && typeof app.setPath === 'function') {
    const sessionDataRoot = path.join(cacheRoot, SESSION_DIRECTORY_NAME)
    fs.mkdirSync(sessionDataRoot, { recursive: true })
    for (const entry of PERSISTENT_SESSION_ENTRIES) {
      const sourcePath = path.join(configRoot, entry)
      const targetPath = path.join(sessionDataRoot, entry)
      if (fs.existsSync(sourcePath) && !fs.existsSync(targetPath)) {
        try {
          fs.cpSync(sourcePath, targetPath, {
            recursive: true,
            preserveTimestamps: true,
          })
        } catch (error) {
          console.warn(
            `[Storage] Could not migrate session entry ${entry}:`,
            error
          )
        }
      }
    }
    app.setPath('sessionData', sessionDataRoot)
  }

  initialized = true
}

function directorySize(rootPath: string): number {
  if (!fs.existsSync(rootPath)) return 0
  let total = 0
  const pending = [rootPath]
  while (pending.length > 0) {
    const current = pending.pop()!
    try {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const entryPath = path.join(current, entry.name)
        if (entry.isDirectory()) pending.push(entryPath)
        else if (entry.isFile()) total += fs.statSync(entryPath).size
      }
    } catch {
      // Ignore files that disappear while size information is collected.
    }
  }
  return total
}

export function getConfigRoot(): string {
  initializeStoragePaths()
  return configRoot
}

export function getCacheRoot(): string {
  initializeStoragePaths()
  return cacheRoot
}

export function getDataRoot(): string {
  initializeStoragePaths()
  return dataRoot
}

export function getCustomizationRoot(): string {
  if (!app.isPackaged) return path.join(process.cwd(), 'user-customization')
  return path.join(getDataRoot(), 'user-customization')
}

export function getStorageSnapshot(): StorageSnapshot {
  initializeStoragePaths()
  const logsRoot = path.join(configRoot, 'logs')
  const legacyCacheBytes = LEGACY_CACHE_ENTRIES.reduce(
    (total, entry) => total + directorySize(path.join(configRoot, entry)),
    0
  )
  return {
    configRoot,
    cacheRoot,
    dataRoot,
    logsRoot,
    defaultDataRoot,
    legacyCacheBytes,
    dataBytes: directorySize(dataRoot),
    logBytes: directorySize(logsRoot),
    restartRequired: Boolean(readStorageConfig().pendingDataRoot),
    pendingDataRoot: readStorageConfig().pendingDataRoot,
  }
}

export async function chooseDataRoot(): Promise<
  | { canceled: true }
  | { canceled: false; path: string; restartRequired: boolean }
> {
  initializeStoragePaths()
  const result = await dialog.showOpenDialog({
    title: '选择 Alice 数据存储目录',
    defaultPath: dataRoot,
    properties: ['openDirectory', 'createDirectory'],
  })
  if (result.canceled || !result.filePaths[0]) return { canceled: true }

  const selectedPath = path.resolve(result.filePaths[0])
  assertSafeMigrationTarget(dataRoot, selectedPath)
  if (selectedPath === path.resolve(dataRoot)) {
    return { canceled: false, path: selectedPath, restartRequired: false }
  }

  fs.mkdirSync(selectedPath, { recursive: true })
  fs.accessSync(selectedPath, fs.constants.R_OK | fs.constants.W_OK)
  writeStorageConfig({
    dataRoot: storageConfig.dataRoot,
    pendingDataRoot: selectedPath,
  })
  storageConfig = readStorageConfig()
  return { canceled: false, path: selectedPath, restartRequired: true }
}

export async function openDataRoot(): Promise<void> {
  initializeStoragePaths()
  const error = await shell.openPath(dataRoot)
  if (error) throw new Error(error)
}

export async function openLogsRoot(): Promise<void> {
  initializeStoragePaths()
  const logsRoot = path.join(configRoot, 'logs')
  fs.mkdirSync(logsRoot, { recursive: true })
  const error = await shell.openPath(logsRoot)
  if (error) throw new Error(error)
}

export function clearLegacyCaches(): { clearedBytes: number } {
  initializeStoragePaths()
  let clearedBytes = 0
  for (const entry of LEGACY_CACHE_ENTRIES) {
    const entryPath = path.join(configRoot, entry)
    clearedBytes += directorySize(entryPath)
    fs.rmSync(entryPath, { recursive: true, force: true })
  }
  return { clearedBytes }
}
