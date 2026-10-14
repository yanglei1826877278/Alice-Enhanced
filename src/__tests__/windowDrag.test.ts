import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { handlers, getCursorScreenPoint } = vi.hoisted(() => ({
  handlers: new Map<string, (event: any) => void>(),
  getCursorScreenPoint: vi.fn(),
}))

vi.mock('electron', () => ({
  ipcMain: {
    on: (channel: string, handler: (event: any) => void) => {
      handlers.set(channel, handler)
    },
  },
  screen: { getCursorScreenPoint },
}))

import { registerWindowDragHandlers } from '../../electron/main/windowDrag'

describe('chat window dragging', () => {
  let window: EventEmitter & {
    webContents: EventEmitter
    isDestroyed: ReturnType<typeof vi.fn>
    getPosition: ReturnType<typeof vi.fn>
    setPosition: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    vi.useFakeTimers()
    handlers.clear()
    getCursorScreenPoint.mockReset().mockReturnValue({ x: 700, y: 50 })
    window = Object.assign(new EventEmitter(), {
      webContents: new EventEmitter(),
      isDestroyed: vi.fn(() => false),
      getPosition: vi.fn(() => [-400, 20]),
      setPosition: vi.fn(),
    })
    registerWindowDragHandlers(() => window as any)
  })

  afterEach(() => {
    window.emit('closed')
    vi.useRealTimers()
  })

  it('moves from the initial cursor offset and stops when released', () => {
    const event = { sender: window.webContents }
    handlers.get('window:drag-start')!(event)
    getCursorScreenPoint.mockReturnValue({ x: 740, y: 80 })
    vi.advanceTimersByTime(16)
    expect(window.setPosition).toHaveBeenLastCalledWith(-360, 50)
    getCursorScreenPoint.mockReturnValue({ x: 760, y: 100 })
    vi.advanceTimersByTime(16)
    expect(window.setPosition).toHaveBeenLastCalledWith(-340, 70)
    handlers.get('window:drag-end')!(event)
    vi.advanceTimersByTime(32)
    expect(window.setPosition).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('ignores drag requests from another window', () => {
    handlers.get('window:drag-start')!({ sender: new EventEmitter() })
    vi.advanceTimersByTime(32)
    expect(window.setPosition).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['blur', 'closed', 'render-process-gone'])(
    'stops dragging on %s even without pointer release',
    event => {
      handlers.get('window:drag-start')!({ sender: window.webContents })
      if (event === 'render-process-gone') window.webContents.emit(event)
      else window.emit(event)
      vi.advanceTimersByTime(32)
      expect(window.setPosition).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
      expect(window.listenerCount('blur')).toBe(0)
    }
  )

  it('restarting a drag replaces the previous timer', () => {
    const event = { sender: window.webContents }
    handlers.get('window:drag-start')!(event)
    handlers.get('window:drag-start')!(event)
    expect(vi.getTimerCount()).toBe(1)
    expect(window.listenerCount('blur')).toBe(1)
  })
})
