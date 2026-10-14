import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rows: new Map<string, any>(),
  send: vi.fn(),
  showNotification: vi.fn(),
  createTask: vi.fn(),
}))

function statement(sql: string) {
  const normalized = sql.replace(/\s+/g, ' ').trim()
  return {
    all: () => {
      if (normalized.startsWith('PRAGMA table_info')) {
        return [
          'id',
          'name',
          'cron_expression',
          'action_type',
          'details',
          'is_active',
          'created_at',
          'last_run',
          'next_run',
          'schedule_type',
          'trigger_at',
        ].map(name => ({ name }))
      }
      if (normalized.includes('WHERE is_active = 1')) {
        return [...mocks.rows.values()].filter(row => row.is_active === 1)
      }
      return [...mocks.rows.values()]
    },
    get: (id: string) => mocks.rows.get(id),
    run: (...args: any[]) => {
      if (normalized.startsWith('INSERT INTO scheduled_tasks')) {
        const [
          id,
          name,
          cron_expression,
          action_type,
          details,
          is_active,
          created_at,
          last_run,
          next_run,
          schedule_type,
          trigger_at,
        ] = args
        mocks.rows.set(id, {
          id,
          name,
          cron_expression,
          action_type,
          details,
          is_active,
          created_at,
          last_run,
          next_run,
          schedule_type,
          trigger_at,
        })
        return { changes: 1 }
      }
      if (normalized.includes('SET is_active = 0, last_run = ?')) {
        const [lastRun, id] = args
        const row = mocks.rows.get(id)
        if (!row || row.is_active !== 1) return { changes: 0 }
        Object.assign(row, { is_active: 0, last_run: lastRun, next_run: null })
        return { changes: 1 }
      }
      if (normalized.startsWith('DELETE FROM scheduled_tasks')) {
        return { changes: mocks.rows.delete(args[0]) ? 1 : 0 }
      }
      if (normalized.includes('SET last_run = ?')) {
        const row = mocks.rows.get(args[1])
        if (row) row.last_run = args[0]
        return { changes: row ? 1 : 0 }
      }
      if (normalized.includes('SET is_active = ?')) {
        const row = mocks.rows.get(args[1])
        if (row) row.is_active = args[0]
        return { changes: row ? 1 : 0 }
      }
      return { changes: 0 }
    },
  }
}

vi.mock('../../electron/main/thoughtVectorStore', () => ({
  getDBInstance: () => ({
    exec: vi.fn(),
    prepare: (sql: string) => statement(sql),
  }),
}))

vi.mock('node-cron', () => ({
  validate: vi.fn(() => true),
  createTask: mocks.createTask,
}))

vi.mock('electron', () => ({
  Notification: class {
    static isSupported() {
      return true
    }
    show() {
      mocks.showNotification()
    }
  },
  webContents: {
    getAllWebContents: () => [
      { isDestroyed: () => false, send: mocks.send },
      { isDestroyed: () => true, send: mocks.send },
    ],
  },
}))

import {
  createScheduledTask,
  initializeSchedulerDB,
  loadAndScheduleAllTasks,
  normalizeTriggerAt,
  shutdownScheduler,
} from '../../electron/main/schedulerManager'

describe('one-time scheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-13T00:00:00.000Z'))
    mocks.rows.clear()
    mocks.send.mockClear()
    mocks.showNotification.mockClear()
    mocks.createTask.mockReset()
    initializeSchedulerDB()
  })

  afterEach(() => {
    shutdownScheduler()
    vi.useRealTimers()
  })

  it('requires a real future RFC3339 timestamp with an explicit timezone', () => {
    expect(normalizeTriggerAt('2026-10-14T09:00:00+08:00')).toEqual(
      expect.objectContaining({ iso: '2026-10-14T01:00:00.000Z' })
    )
    expect(() => normalizeTriggerAt('2026-10-14T09:00:00')).toThrow('explicit offset')
    expect(() => normalizeTriggerAt('2026-02-30T09:00:00Z')).toThrow('calendar')
    expect(() => normalizeTriggerAt('2026-10-14T09:00:00+15:00')).toThrow('offset')
    expect(() => normalizeTriggerAt('2026-10-12T09:00:00Z')).toThrow('future')
  })

  it('persists, fires and atomically deactivates a one-time reminder once', async () => {
    const created = await createScheduledTask('Tea', '', 'reminder', 'Drink tea', {
      scheduleType: 'once',
      triggerAt: '2026-10-13T00:00:01Z',
    })
    expect(created).toEqual(
      expect.objectContaining({
        success: true,
        triggerAt: '2026-10-13T00:00:01.000Z',
        localTimeZone: expect.any(String),
      })
    )
    const row = mocks.rows.get(created.taskId!)
    expect(row).toEqual(expect.objectContaining({ is_active: 1, schedule_type: 'once' }))

    await vi.advanceTimersByTimeAsync(1_000)
    expect(row.is_active).toBe(0)
    expect(mocks.send).toHaveBeenCalledTimes(1)
    expect(mocks.send).toHaveBeenCalledWith(
      'scheduler:reminder',
      expect.objectContaining({ taskId: created.taskId, message: 'Drink tea' })
    )
    expect(mocks.showNotification).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(mocks.send).toHaveBeenCalledTimes(1)
  })

  it('restores an active reminder after restart without duplicate firing', async () => {
    mocks.rows.set('restored', {
      id: 'restored',
      name: 'Restored',
      cron_expression: '',
      action_type: 'reminder',
      details: 'Still here',
      is_active: 1,
      created_at: '2026-10-12T00:00:00.000Z',
      last_run: null,
      next_run: '2026-10-13T00:00:01.000Z',
      schedule_type: 'once',
      trigger_at: '2026-10-13T00:00:01.000Z',
    })
    await loadAndScheduleAllTasks()
    await loadAndScheduleAllTasks()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(mocks.send).toHaveBeenCalledTimes(1)
    expect(mocks.rows.get('restored').is_active).toBe(0)
  })
})
