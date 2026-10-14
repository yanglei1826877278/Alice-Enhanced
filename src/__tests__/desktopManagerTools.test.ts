import { mkdtempSync, rmSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

const { handlers, showMessageBox } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  showMessageBox: vi.fn(),
}))

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => testRoot) },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
      handlers.set(channel, handler)
    }),
    listenerCount: vi.fn(() => 0),
    removeAllListeners: vi.fn(),
  },
  BrowserWindow: { fromWebContents: vi.fn(() => null) },
  dialog: { showMessageBox },
}))

import DesktopManager from '../../electron/main/desktopManager'

const testRoot = mkdtempSync(path.join(os.tmpdir(), 'alice-desktop-tools-'))
const approvedRoot = path.join(testRoot, 'approved')
const outsideRoot = path.join(testRoot, 'outside')
const event = { sender: { id: 1 } }

describe('DesktopManager agent tools', () => {
  beforeAll(async () => {
    await fs.mkdir(path.join(approvedRoot, 'nested'), { recursive: true })
    await fs.mkdir(outsideRoot, { recursive: true })
    DesktopManager.getInstance()
  })

  afterAll(() => {
    rmSync(testRoot, { recursive: true, force: true })
  })

  beforeEach(() => {
    showMessageBox.mockReset()
  })

  it('requires directory approval, reuses it for descendants, and reads UTF-8 text', async () => {
    const firstPath = path.join(approvedRoot, 'first.txt')
    const nestedPath = path.join(approvedRoot, 'nested', 'second.txt')
    await fs.writeFile(firstPath, 'hello')
    await fs.writeFile(nestedPath, 'nested')
    showMessageBox.mockResolvedValue({ response: 1 })
    const readFile = handlers.get('desktop:readFile')!

    await expect(readFile(event, { path: firstPath })).resolves.toEqual(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ text: 'hello', truncated: false }),
      })
    )
    await expect(readFile(event, { path: nestedPath })).resolves.toEqual(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ text: 'nested' }),
      })
    )
    expect(showMessageBox).toHaveBeenCalledTimes(1)
  })

  it('does not let an approved root authorize an outside path', async () => {
    const outsidePath = path.join(outsideRoot, 'secret.txt')
    await fs.writeFile(outsidePath, 'secret')
    showMessageBox.mockResolvedValue({ response: 0 })
    const result = await handlers.get('desktop:readFile')!(event, {
      path: outsidePath,
    })
    expect(result).toEqual({
      success: false,
      error: 'Directory access denied by user.',
    })
  })

  it('rejects binary and invalid UTF-8 files and truncates large text', async () => {
    const binaryPath = path.join(approvedRoot, 'binary.bin')
    const invalidPath = path.join(approvedRoot, 'invalid.txt')
    const largePath = path.join(approvedRoot, 'large.txt')
    await fs.writeFile(binaryPath, Buffer.from([65, 0, 66]))
    await fs.writeFile(invalidPath, Buffer.from([0xc3, 0x28]))
    await fs.writeFile(largePath, 'x'.repeat(300_000))
    const readFile = handlers.get('desktop:readFile')!

    await expect(readFile(event, { path: binaryPath })).resolves.toEqual(
      expect.objectContaining({
        success: false,
        error: expect.stringContaining('Binary'),
      })
    )
    await expect(readFile(event, { path: invalidPath })).resolves.toEqual(
      expect.objectContaining({
        success: false,
        error: expect.stringContaining('UTF-8'),
      })
    )
    const large = await readFile(event, { path: largePath, maxChars: 1_000 })
    expect(large.data.text).toHaveLength(1_000)
    expect(large.data.truncated).toBe(true)
    expect(large.data.size).toBe(300_000)
  })

  it('loads approved PNG images as visual data and rejects unsupported binaries', async () => {
    const pngPath = path.join(approvedRoot, 'vision.png')
    const binaryPath = path.join(approvedRoot, 'not-an-image.bin')
    const pngBytes = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
    ])
    await fs.writeFile(pngPath, pngBytes)
    await fs.writeFile(binaryPath, Buffer.from([1, 2, 3, 4]))

    const viewImage = handlers.get('desktop:viewImage')!
    await expect(viewImage(event, { path: pngPath })).resolves.toEqual({
      success: true,
      data: {
        type: 'image',
        path: await fs.realpath(pngPath),
        mimeType: 'image/png',
        size: pngBytes.length,
        imageUrl: `data:image/png;base64,${pngBytes.toString('base64')}`,
      },
    })
    await expect(viewImage(event, { path: binaryPath })).resolves.toEqual(
      expect.objectContaining({
        success: false,
        error: expect.stringContaining('PNG, JPEG, and WebP'),
      })
    )
  })

  it('requires explicit approval before starting a background command', async () => {
    showMessageBox.mockResolvedValue({ response: 0 })
    const result = await handlers.get('desktop:process')!(event, {
      action: 'start',
      command: 'echo should-not-run',
    })
    expect(result).toEqual({
      success: false,
      error: 'Command execution denied by user.',
    })
  })

  it('reuses session write approval for later changes in the same folder', async () => {
    const target = path.join(approvedRoot, 'write-target.txt')
    const writeFile = handlers.get('desktop:writeTextFile')!
    showMessageBox.mockResolvedValueOnce({ response: 1 })
    await expect(
      writeFile(event, { path: target, content: 'one', mode: 'create' })
    ).resolves.toEqual(expect.objectContaining({ success: true }))
    await expect(fs.readFile(target, 'utf8')).resolves.toBe('one')

    await expect(
      writeFile(event, { path: target, content: ' two', mode: 'append' })
    ).resolves.toEqual(expect.objectContaining({ success: true }))
    await expect(fs.readFile(target, 'utf8')).resolves.toBe('one two')

    await writeFile(event, {
      path: target,
      content: 'replacement',
      mode: 'overwrite',
    })
    await expect(fs.readFile(target, 'utf8')).resolves.toBe('replacement')
    expect(
      (await fs.readdir(approvedRoot)).some(name => name.includes('.alice-'))
    ).toBe(false)
    expect(showMessageBox).toHaveBeenCalledTimes(1)
  })

  it('rejects relative, oversized, NUL, and create-over-existing writes', async () => {
    const writeFile = handlers.get('desktop:writeTextFile')!
    await expect(
      writeFile(event, { path: 'relative.txt', content: 'x', mode: 'create' })
    ).resolves.toEqual(
      expect.objectContaining({
        success: false,
        error: expect.stringContaining('absolute'),
      })
    )
    await expect(
      writeFile(event, {
        path: path.join(approvedRoot, 'huge.txt'),
        content: 'x'.repeat(512 * 1024 + 1),
        mode: 'create',
      })
    ).resolves.toEqual(
      expect.objectContaining({
        success: false,
        error: expect.stringContaining('write limit'),
      })
    )
    await expect(
      writeFile(event, {
        path: path.join(approvedRoot, 'nul.txt'),
        content: 'a\0b',
        mode: 'create',
      })
    ).resolves.toEqual(
      expect.objectContaining({
        success: false,
        error: expect.stringContaining('NUL'),
      })
    )
    await expect(
      writeFile(event, {
        path: path.join(approvedRoot, 'write-target.txt'),
        content: 'x',
        mode: 'create',
      })
    ).resolves.toEqual(
      expect.objectContaining({
        success: false,
        error: expect.stringContaining('already exists'),
      })
    )
  })

  it('does not append text to an existing binary file', async () => {
    const target = path.join(approvedRoot, 'existing-binary.bin')
    const original = Buffer.from([65, 0, 66])
    await fs.writeFile(target, original)
    showMessageBox.mockResolvedValue({ response: 1 })
    const result = await handlers.get('desktop:writeTextFile')!(event, {
      path: target,
      content: 'text',
      mode: 'append',
    })
    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        error: expect.stringContaining('binary'),
      })
    )
    await expect(fs.readFile(target)).resolves.toEqual(original)
  })

  it('keeps directory grants isolated between renderers', async () => {
    const secondEvent = { sender: { id: 2 } }
    showMessageBox.mockResolvedValue({ response: 0 })
    const result = await handlers.get('desktop:readFile')!(secondEvent, {
      path: path.join(approvedRoot, 'first.txt'),
    })
    expect(result.error).toContain('denied')
  })

  it('searches bounded files by glob and literal text while skipping excluded content', async () => {
    const searchRoot = path.join(testRoot, 'search')
    await fs.mkdir(path.join(searchRoot, 'src'), { recursive: true })
    await fs.mkdir(path.join(searchRoot, 'node_modules'), { recursive: true })
    await fs.writeFile(path.join(searchRoot, 'src', 'a.ts'), 'Hello needle')
    await fs.writeFile(path.join(searchRoot, 'src', 'b.ts'), 'no match')
    await fs.writeFile(
      path.join(searchRoot, 'node_modules', 'hidden.ts'),
      'needle'
    )
    await fs.writeFile(
      path.join(searchRoot, 'src', 'binary.ts'),
      Buffer.from([0, 1, 2])
    )
    showMessageBox.mockResolvedValue({ response: 1 })
    const result = await handlers.get('desktop:searchFiles')!(event, {
      root: searchRoot,
      pattern: '**/*.ts',
      query: 'NEEDLE',
    })
    expect(result.success).toBe(true)
    expect(result.data.results).toEqual([
      expect.objectContaining({ relativePath: 'src/a.ts', matchCount: 1 }),
    ])
    expect(result.data.scanned).toBeGreaterThan(0)
    expect(result.data.skipped).toBeGreaterThan(0)
  })

  it('truncates file search results at the configured result limit', async () => {
    const searchRoot = path.join(testRoot, 'many-search-results')
    await fs.mkdir(searchRoot, { recursive: true })
    await Promise.all(
      Array.from({ length: 110 }, (_, index) =>
        fs.writeFile(path.join(searchRoot, `file-${index}.txt`), 'x')
      )
    )
    showMessageBox.mockResolvedValue({ response: 1 })
    const result = await handlers.get('desktop:searchFiles')!(event, {
      root: searchRoot,
      pattern: '*.txt',
    })
    expect(result.data.results).toHaveLength(100)
    expect(result.data.truncated).toBe(true)
  })

  it('persists permission mode and enforces read-only writes', async () => {
    const setMode = handlers.get('permissions:set-mode')!
    const getPermissions = handlers.get('permissions:get')!
    const writeFile = handlers.get('desktop:writeTextFile')!

    await expect(setMode(event, 'read-only')).resolves.toEqual(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ mode: 'read-only' }),
      })
    )
    await expect(getPermissions(event)).resolves.toEqual(
      expect.objectContaining({
        data: expect.objectContaining({ mode: 'read-only' }),
      })
    )
    await expect(
      writeFile(event, {
        path: path.join(approvedRoot, 'read-only-denied.txt'),
        content: 'nope',
        mode: 'create',
      })
    ).resolves.toEqual(
      expect.objectContaining({
        success: false,
        error: expect.stringContaining('read-only'),
      })
    )

    await setMode(event, 'workspace')
  })
})
