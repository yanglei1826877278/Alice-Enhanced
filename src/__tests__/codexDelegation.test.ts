import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const showNotification = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  app: {
    getPath: () => 'C:\\alice-test',
    getVersion: () => '0.0.0-test',
    isReady: () => true,
  },
  ipcMain: { handle: vi.fn() },
  shell: { openExternal: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn() },
  dialog: { showMessageBox: vi.fn() },
  Notification: class {
    static isSupported() {
      return true
    }
    show() {
      showNotification()
    }
  },
}))

vi.mock('../../electron/main/windowManager', () => ({
  getMainWindow: () => null,
}))

import { CodexAppServerManager } from '../../electron/main/codexAppServerManager'
import DesktopManager from '../../electron/main/desktopManager'

class FakeClient extends EventEmitter {
  request = vi.fn(async (method: string) => {
    if (method === 'thread/start') return { thread: { id: 'thread-1' } }
    if (method === 'turn/start') return { turn: { id: 'turn-1' } }
    if (method === 'turn/interrupt') return {}
    return {}
  })
}

async function settle(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
  await new Promise(resolve => setTimeout(resolve, 0))
}

describe('Codex delegated tasks', () => {
  let manager: CodexAppServerManager
  let client: FakeClient
  const sender = {
    id: 7,
    isDestroyed: vi.fn(() => false),
    send: vi.fn(),
  } as any

  beforeEach(() => {
    sender.send.mockReset()
    sender.isDestroyed.mockReturnValue(false)
    showNotification.mockClear()
    manager = new CodexAppServerManager()
    client = new FakeClient()
    vi.spyOn(manager, 'getClient').mockResolvedValue(client as any)
    vi.spyOn(DesktopManager, 'getInstance').mockReturnValue({
      authorizeDirectory: vi.fn(async (_sender, cwd) => cwd),
    } as any)
  })

  it('runs a real app-server turn and retains its completed result', async () => {
    const started = await manager.startDelegatedTask(sender, {
      prompt: 'Inspect the project',
      cwd: 'C:\\project',
    })
    expect(started.success).toBe(true)
    expect(started.data?.status).toBe('starting')
    await settle()

    const taskId = String(started.data?.taskId)
    expect(client.request).toHaveBeenCalledWith(
      'turn/start',
      expect.objectContaining({ threadId: 'thread-1' }),
      expect.any(Number)
    )
    client.emit('notification', {
      method: 'item/agentMessage/delta',
      params: { threadId: 'thread-1', turnId: 'turn-1', delta: 'result' },
    })
    client.emit('notification', {
      method: 'turn/completed',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        turn: { status: 'completed' },
      },
    })

    const status = await manager.manageDelegatedTask(sender, {
      action: 'status',
      taskId,
    })
    expect(status.data).toEqual(
      expect.objectContaining({ status: 'completed', result: 'result' })
    )
    expect(sender.send).toHaveBeenCalledTimes(1)
    expect(sender.send).toHaveBeenCalledWith(
      'agent:status',
      expect.objectContaining({ taskId, status: 'completed' })
    )
    expect(showNotification).toHaveBeenCalledTimes(1)

    client.emit('notification', {
      method: 'turn/completed',
      params: { threadId: 'thread-1', turnId: 'turn-1', turn: { status: 'completed' } },
    })
    expect(sender.send).toHaveBeenCalledTimes(1)
    expect(showNotification).toHaveBeenCalledTimes(1)
  })

  it('keeps completion state and native notification when renderer delivery fails', async () => {
    const started = await manager.startDelegatedTask(sender, {
      prompt: 'Inspect the project',
      cwd: 'C:\\project',
    })
    await settle()
    const taskId = String(started.data?.taskId)
    sender.send.mockImplementationOnce(() => {
      throw new Error('renderer gone')
    })
    client.emit('notification', {
      method: 'turn/completed',
      params: { threadId: 'thread-1', turnId: 'turn-1', turn: { status: 'completed' } },
    })

    await expect(
      manager.manageDelegatedTask(sender, { action: 'status', taskId })
    ).resolves.toEqual(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ status: 'completed' }),
      })
    )
    expect(showNotification).toHaveBeenCalledTimes(1)
  })

  it('cancels during startup without launching a hidden turn', async () => {
    let releaseApproval!: () => void
    const approval = new Promise<void>(resolve => {
      releaseApproval = resolve
    })
    vi.spyOn(DesktopManager, 'getInstance').mockReturnValue({
      authorizeDirectory: vi.fn(async (_sender, cwd) => {
        await approval
        return cwd
      }),
    } as any)
    const started = await manager.startDelegatedTask(sender, {
      prompt: 'Inspect the project',
      cwd: 'C:\\project',
    })
    const taskId = String(started.data?.taskId)
    const cancelling = await manager.manageDelegatedTask(sender, {
      action: 'cancel',
      taskId,
    })
    expect(cancelling.data?.status).toBe('cancelling')
    releaseApproval()
    await settle()

    const status = await manager.manageDelegatedTask(sender, {
      action: 'status',
      taskId,
    })
    expect(status.data?.status).toBe('cancelled')
    expect(client.request).not.toHaveBeenCalledWith(
      'turn/start',
      expect.anything(),
      expect.anything()
    )
  })

  it('interrupts a running turn and rejects another renderer task id', async () => {
    const started = await manager.startDelegatedTask(sender, {
      prompt: 'Inspect the project',
      cwd: 'C:\\project',
    })
    await settle()
    const taskId = String(started.data?.taskId)
    await expect(
      manager.manageDelegatedTask({ id: 8 } as any, {
        action: 'status',
        taskId,
      })
    ).resolves.toEqual(
      expect.objectContaining({ success: false, error: expect.stringContaining('Unknown') })
    )

    const cancelled = await manager.manageDelegatedTask(sender, {
      action: 'cancel',
      taskId,
    })
    expect(cancelled.data?.status).toBe('cancelled')
    expect(client.request).toHaveBeenCalledWith('turn/interrupt', {
      threadId: 'thread-1',
      turnId: 'turn-1',
    })
  })
})
