import { ipcMain, type WebContents } from 'electron'
import fs from 'fs/promises'
import { exec } from 'child_process'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { minimatch } from 'minimatch'
import { isPathWithinRoot } from './securityBoundaries'
import { BackgroundProcessManager } from './backgroundProcessManager'
import { fetchPublicText } from './safeWebFetch'
import { PermissionManager } from './permissionManager'

const MAX_READ_FILE_BYTES = 256 * 1024
const MAX_VIEW_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_WRITE_BYTES = 512 * 1024
const MAX_RESULT_FILE_BYTES = 2 * 1024 * 1024
const SEARCH_MAX_ENTRIES = 5_000
const SEARCH_MAX_RESULTS = 100
const SEARCH_FILE_BYTES = 64 * 1024
const SEARCH_TIMEOUT_MS = 3_000

function detectSupportedImageMime(
  bytes: Buffer
): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (
    bytes.length >= 8 &&
    bytes
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png'
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return 'image/jpeg'
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp'
  }
  return null
}

class DesktopManager {
  private static instance: DesktopManager | null = null
  private readonly permissions = new PermissionManager()
  private readonly backgroundProcesses = new BackgroundProcessManager()

  constructor() {
    if (DesktopManager.instance) {
      return DesktopManager.instance
    }
    DesktopManager.instance = this
    this.registerIpcHandlers()
  }

  static getInstance(): DesktopManager {
    if (!DesktopManager.instance) {
      DesktopManager.instance = new DesktopManager()
    }
    return DesktopManager.instance
  }

  dispose(): void {
    this.backgroundProcesses.dispose()
  }

  private registerIpcHandlers() {
    // Remove existing handlers if they exist
    if (ipcMain.listenerCount('desktop:listDirectory') > 0) {
      ipcMain.removeAllListeners('desktop:listDirectory')
    }
    if (ipcMain.listenerCount('desktop:executeCommand') > 0) {
      ipcMain.removeAllListeners('desktop:executeCommand')
    }
    ipcMain.handle('desktop:listDirectory', async (event, dirPath) => {
      try {
        if (typeof dirPath !== 'string' || dirPath.trim().length === 0) {
          return { success: false, error: 'A directory path is required.' }
        }

        const requestedPath = await fs.realpath(dirPath.trim())
        const stat = await fs.stat(requestedPath)
        if (!stat.isDirectory()) {
          return {
            success: false,
            error: 'The requested path is not a directory.',
          }
        }

        await this.authorizeDirectory(event.sender, requestedPath)

        const files = await fs.readdir(requestedPath)
        return { success: true, files }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    })

    ipcMain.handle('desktop:executeCommand', async (event, input: unknown) => {
      let validatedCommand: string
      let cwd: string | undefined
      try {
        const rawCommand =
          typeof input === 'object' && input !== null
            ? (input as { command?: unknown }).command
            : input
        validatedCommand = this.validateCommand(rawCommand)
        const rawCwd =
          typeof input === 'object' && input !== null
            ? (input as { cwd?: unknown }).cwd
            : undefined
        if (typeof rawCwd === 'string' && rawCwd.trim()) {
          cwd = await fs.realpath(rawCwd.trim())
          const stat = await fs.stat(cwd)
          if (!stat.isDirectory())
            throw new Error('Command cwd is not a directory.')
          await this.authorizeDirectory(event.sender, cwd)
        }
        await this.permissions.authorizeCommand(
          event.sender,
          validatedCommand,
          cwd
        )
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }
      }

      return new Promise(resolve => {
        exec(
          validatedCommand,
          { timeout: 60_000, maxBuffer: 1024 * 1024, cwd },
          (error, stdout, stderr) => {
            if (error) {
              resolve({
                success: false,
                error: stderr ? `${error.message}\n${stderr}` : error.message,
              })
              return
            }
            resolve({
              success: true,
              output: stderr ? `${stdout}${stderr}` : stdout,
            })
          }
        )
      })
    })

    ipcMain.handle('desktop:readFile', async (event, args: any) => {
      try {
        if (typeof args?.path !== 'string' || !args.path.trim()) {
          return { success: false, error: 'A file path is required.' }
        }
        const requestedPath = await fs.realpath(args.path.trim())
        const stat = await fs.stat(requestedPath)
        if (!stat.isFile()) {
          return { success: false, error: 'The requested path is not a file.' }
        }
        await this.authorizeDirectory(event.sender, path.dirname(requestedPath))

        const handle = await fs.open(requestedPath, 'r')
        try {
          const bytesToRead = Math.min(stat.size, MAX_READ_FILE_BYTES + 1)
          const buffer = Buffer.alloc(bytesToRead)
          const { bytesRead } = await handle.read(buffer, 0, bytesToRead, 0)
          const bytes = buffer.subarray(0, bytesRead)
          if (bytes.includes(0)) {
            return { success: false, error: 'Binary files cannot be read.' }
          }
          let text: string
          try {
            text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
          } catch {
            return {
              success: false,
              error:
                'The file is not valid UTF-8 text or appears to be binary.',
            }
          }
          const maxChars = Math.min(
            Math.max(1, Number(args.maxChars) || 50_000),
            100_000
          )
          const truncated =
            stat.size > MAX_READ_FILE_BYTES || text.length > maxChars
          return {
            success: true,
            data: {
              path: requestedPath,
              text: text.slice(0, maxChars),
              truncated,
              size: stat.size,
            },
          }
        } finally {
          await handle.close()
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    })

    ipcMain.handle('desktop:viewImage', async (event, args: any) => {
      try {
        if (typeof args?.path !== 'string' || !args.path.trim()) {
          return { success: false, error: 'An image path is required.' }
        }
        const requestedPath = await fs.realpath(args.path.trim())
        const stat = await fs.stat(requestedPath)
        if (!stat.isFile()) {
          return { success: false, error: 'The requested path is not a file.' }
        }
        if (stat.size <= 0 || stat.size > MAX_VIEW_IMAGE_BYTES) {
          return {
            success: false,
            error: `Image must be between 1 byte and ${MAX_VIEW_IMAGE_BYTES} bytes.`,
          }
        }
        await this.authorizeDirectory(event.sender, path.dirname(requestedPath))
        const bytes = await fs.readFile(requestedPath)
        const mimeType = detectSupportedImageMime(bytes)
        if (!mimeType) {
          return {
            success: false,
            error: 'Only valid PNG, JPEG, and WebP images are supported.',
          }
        }
        return {
          success: true,
          data: {
            type: 'image',
            path: requestedPath,
            mimeType,
            size: stat.size,
            imageUrl: `data:${mimeType};base64,${bytes.toString('base64')}`,
          },
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    })

    ipcMain.handle('desktop:webFetch', async (_event, args: any) => {
      try {
        return { success: true, data: await fetchPublicText(args || {}) }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    })

    ipcMain.handle('desktop:writeTextFile', async (event, args: any) => {
      try {
        const mode = args?.mode
        if (!['create', 'append', 'overwrite'].includes(mode)) {
          throw new Error('Mode must be create, append, or overwrite.')
        }
        if (typeof args?.path !== 'string' || !args.path.trim()) {
          throw new Error('A file path is required.')
        }
        if (typeof args?.content !== 'string') {
          throw new Error('Text content is required.')
        }
        if (args.content.includes('\0'))
          throw new Error('NUL bytes are not allowed.')
        const contentBytes = Buffer.byteLength(args.content, 'utf8')
        if (contentBytes > MAX_WRITE_BYTES) {
          throw new Error(
            `Text exceeds the ${MAX_WRITE_BYTES} byte write limit.`
          )
        }

        if (!path.isAbsolute(args.path.trim())) {
          throw new Error('An absolute file path is required.')
        }
        const requestedPath = path.resolve(args.path.trim())
        let exists = false
        let targetPath = requestedPath
        let existingSize = 0
        try {
          targetPath = await fs.realpath(requestedPath)
          const stat = await fs.stat(targetPath)
          if (!stat.isFile())
            throw new Error('The target is not a regular file.')
          exists = true
          existingSize = stat.size
        } catch (error: any) {
          if (error?.code !== 'ENOENT') throw error
        }

        const parentPath = await fs.realpath(path.dirname(targetPath))
        await this.authorizeWriteDirectory(event.sender, parentPath)
        if (!isPathWithinRoot(parentPath, targetPath)) {
          throw new Error('Target path is outside the approved directory.')
        }
        if (mode === 'create' && exists) {
          throw new Error(
            'The target file already exists; create will not replace it.'
          )
        }
        if (
          mode === 'append' &&
          existingSize + contentBytes > MAX_RESULT_FILE_BYTES
        ) {
          throw new Error('Appending would exceed the maximum text file size.')
        }
        if (mode === 'append' && exists) {
          const existingBytes = await fs.readFile(targetPath)
          if (existingBytes.includes(0)) {
            throw new Error('Cannot append text to a binary file.')
          }
          try {
            new TextDecoder('utf-8', { fatal: true }).decode(existingBytes)
          } catch {
            throw new Error(
              'Cannot append to a file that is not valid UTF-8 text.'
            )
          }
        }
        if (mode === 'overwrite') {
          const temporaryPath = path.join(
            parentPath,
            `.${path.basename(targetPath)}.alice-${randomUUID()}.tmp`
          )
          try {
            await fs.writeFile(temporaryPath, args.content, {
              encoding: 'utf8',
              flag: 'wx',
            })
            if (exists) {
              const existingStat = await fs.stat(targetPath)
              await fs.chmod(temporaryPath, existingStat.mode)
            }
            await fs.rename(temporaryPath, targetPath)
          } catch (error) {
            await fs.rm(temporaryPath, { force: true }).catch(() => undefined)
            throw error
          }
        } else {
          await fs.writeFile(targetPath, args.content, {
            encoding: 'utf8',
            flag: mode === 'create' ? 'wx' : 'a',
          })
        }
        const finalStat = await fs.stat(targetPath)
        return {
          success: true,
          data: { path: targetPath, mode, size: finalStat.size },
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    })

    ipcMain.handle('desktop:searchFiles', async (event, args: any) => {
      try {
        if (typeof args?.root !== 'string' || !args.root.trim()) {
          throw new Error('A search root directory is required.')
        }
        const root = await fs.realpath(args.root.trim())
        const stat = await fs.stat(root)
        if (!stat.isDirectory())
          throw new Error('Search root is not a directory.')
        await this.authorizeDirectory(event.sender, root)
        return {
          success: true,
          data: await this.searchFiles(root, args?.pattern, args?.query),
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    })

    ipcMain.handle('desktop:process', async (event, args: any) => {
      try {
        const action = args?.action
        if (action === 'start') {
          const command = this.validateCommand(args?.command)
          let cwd: string | undefined
          if (typeof args?.cwd === 'string' && args.cwd.trim()) {
            cwd = await fs.realpath(args.cwd.trim())
            const stat = await fs.stat(cwd)
            if (!stat.isDirectory())
              throw new Error('Process cwd is not a directory.')
            await this.authorizeDirectory(event.sender, cwd)
          }
          await this.permissions.authorizeCommand(
            event.sender,
            command,
            cwd,
            'Start background process'
          )
          return {
            success: true,
            data: this.backgroundProcesses.start(command, cwd),
          }
        }
        if (action === 'list') {
          return { success: true, data: this.backgroundProcesses.list() }
        }
        if (action === 'poll' || action === 'output') {
          return {
            success: true,
            data: this.backgroundProcesses.output(
              String(args?.processId || ''),
              Number(args?.cursor) || 0
            ),
          }
        }
        if (action === 'write') {
          return {
            success: true,
            data: this.backgroundProcesses.write(
              String(args?.processId || ''),
              String(args?.input || '')
            ),
          }
        }
        if (action === 'stop') {
          return {
            success: true,
            data: this.backgroundProcesses.stop(String(args?.processId || '')),
          }
        }
        return { success: false, error: 'Unsupported process action.' }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    })
  }

  async authorizeDirectory(sender: WebContents, directory: string) {
    const requestedPath = await fs.realpath(directory)
    await this.permissions.authorizePath(sender, 'read', requestedPath)
    return requestedPath
  }

  private async authorizeWriteDirectory(
    sender: WebContents,
    directory: string
  ): Promise<string> {
    const requestedPath = await fs.realpath(directory)
    await this.permissions.authorizePath(sender, 'write', requestedPath)
    return requestedPath
  }

  private validateCommand(command: unknown): string {
    if (typeof command !== 'string' || command.trim().length === 0) {
      throw new Error('A command is required.')
    }
    if (command.length > 16_000) throw new Error('Command is too long.')
    return command
  }

  private async searchFiles(
    root: string,
    rawPattern?: unknown,
    rawQuery?: unknown
  ): Promise<Record<string, any>> {
    const pattern =
      typeof rawPattern === 'string' && rawPattern.trim()
        ? rawPattern.trim()
        : '**/*'
    if (pattern.length > 500) throw new Error('Search pattern is too long.')
    const query = typeof rawQuery === 'string' ? rawQuery : ''
    if (query.length > 1_000) throw new Error('Search text is too long.')
    const matcher = (candidate: string) =>
      minimatch(candidate, pattern, {
        dot: true,
        nocase: process.platform === 'win32',
      })
    const startedAt = Date.now()
    const pending = [root]
    const results: Array<Record<string, any>> = []
    let scanned = 0
    let truncated = false
    let skipped = 0

    while (pending.length > 0) {
      if (
        scanned >= SEARCH_MAX_ENTRIES ||
        results.length >= SEARCH_MAX_RESULTS ||
        Date.now() - startedAt >= SEARCH_TIMEOUT_MS
      ) {
        truncated = true
        break
      }
      const directory = pending.pop()!
      let entries
      try {
        entries = await fs.readdir(directory, { withFileTypes: true })
      } catch {
        skipped += 1
        continue
      }
      for (const entry of entries) {
        if (
          scanned >= SEARCH_MAX_ENTRIES ||
          results.length >= SEARCH_MAX_RESULTS ||
          Date.now() - startedAt >= SEARCH_TIMEOUT_MS
        ) {
          truncated = true
          break
        }
        if (entry.name === '.git' || entry.name === 'node_modules') {
          skipped += 1
          continue
        }
        scanned += 1
        const fullPath = path.join(directory, entry.name)
        const relativePath = path
          .relative(root, fullPath)
          .split(path.sep)
          .join('/')
        if (entry.isSymbolicLink()) {
          skipped += 1
          continue
        }
        if (entry.isDirectory()) {
          pending.push(fullPath)
          continue
        }
        if (!entry.isFile() || !matcher(relativePath)) continue

        let matchCount: number | undefined
        if (query) {
          let fileStat
          let bytes
          try {
            fileStat = await fs.stat(fullPath)
            if (fileStat.size > SEARCH_FILE_BYTES) {
              skipped += 1
              continue
            }
            bytes = await fs.readFile(fullPath)
          } catch {
            skipped += 1
            continue
          }
          if (bytes.includes(0)) {
            skipped += 1
            continue
          }
          let text: string
          try {
            text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
          } catch {
            skipped += 1
            continue
          }
          const haystack = text.toLocaleLowerCase()
          const needle = query.toLocaleLowerCase()
          let index = 0
          matchCount = 0
          while ((index = haystack.indexOf(needle, index)) >= 0) {
            matchCount += 1
            index += Math.max(needle.length, 1)
          }
          if (matchCount === 0) continue
        }
        results.push({
          path: fullPath,
          relativePath,
          ...(query ? { matchCount } : {}),
        })
      }
    }

    return {
      root,
      pattern,
      query: query || undefined,
      results,
      scanned,
      truncated,
      elapsedMs: Date.now() - startedAt,
      skipped,
    }
  }
}

export default DesktopManager
