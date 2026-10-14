import { mkdtempSync, rmSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { handlers, showMessageBox } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  showMessageBox: vi.fn(),
}))

vi.mock('electron', () => ({
  app: { getPath: () => testRoot },
  ipcMain: {
    handle: (channel: string, handler: (...args: any[]) => any) => {
      handlers.set(channel, handler)
    },
  },
  BrowserWindow: { fromWebContents: () => null },
  dialog: { showMessageBox },
}))

import { PermissionManager } from '../../electron/main/permissionManager'

const testRoot = mkdtempSync(path.join(os.tmpdir(), 'alice-permissions-'))
const event = { sender: { id: 1 } }
const highRiskCommands = [
  'bash -c "echo hello"',
  'powershell -Command "Get-Date"',
  'node -e "console.log(1)"',
  'git status > status.txt',
  'echo $HOME',
  'rm -rf ./build',
  'git reset --hard HEAD',
]

describe('PermissionManager command approvals', () => {
  let manager: PermissionManager

  beforeEach(async () => {
    await fs.rm(path.join(testRoot, 'alice-permissions.json'), { force: true })
    handlers.clear()
    showMessageBox.mockReset()
    showMessageBox.mockResolvedValue({ response: 0 })
    manager = new PermissionManager()
  })

  afterAll(() => rmSync(testRoot, { recursive: true, force: true }))

  it.each(['pnpm test', ...highRiskCommands])(
    'executes %s without prompting in persisted full-access mode',
    async command => {
      await handlers.get('permissions:set-mode')!(event, 'full-access')
      const reloaded = new PermissionManager()
      await expect(
        reloaded.authorizeCommand(event.sender as any, command)
      ).resolves.toBeUndefined()
      expect(showMessageBox).not.toHaveBeenCalled()
    }
  )

  it('still enforces explicit command deny rules in full-access mode', async () => {
    showMessageBox.mockResolvedValueOnce({ response: 4 })
    await expect(
      manager.authorizeCommand(event.sender as any, 'pnpm test')
    ).rejects.toThrow('Command execution denied by user.')
    await handlers.get('permissions:set-mode')!(event, 'full-access')
    showMessageBox.mockClear()
    await expect(
      manager.authorizeCommand(event.sender as any, 'echo hello && pnpm test')
    ).rejects.toThrow('Command denied by permission rule.')
    expect(showMessageBox).not.toHaveBeenCalled()
  })

  it('requires confirmation each time for shell wrappers in workspace mode', async () => {
    showMessageBox.mockResolvedValue({ response: 1 })
    for (let index = 0; index < 2; index += 1) {
      await manager.authorizeCommand(event.sender as any, highRiskCommands[0])
    }
    expect(showMessageBox).toHaveBeenCalledTimes(2)
    expect(showMessageBox.mock.calls[0][0].buttons).toEqual(['Deny', 'Run once'])
  })

  it('rejects high-risk commands without prompting in read-only mode', async () => {
    await handlers.get('permissions:set-mode')!(event, 'read-only')
    await expect(
      manager.authorizeCommand(event.sender as any, highRiskCommands[0])
    ).rejects.toThrow('Command is not allowed in read-only mode.')
    expect(showMessageBox).not.toHaveBeenCalled()
  })
})
