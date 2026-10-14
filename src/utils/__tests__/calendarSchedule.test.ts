import { beforeEach, describe, expect, it, vi } from 'vitest'
import { schedule_task } from '../functions/calendar'

describe('schedule_task one-time reminders', () => {
  const invoke = vi.fn()

  beforeEach(() => {
    invoke.mockReset()
    vi.stubGlobal('window', { aliceIPC: { invoke } })
  })

  it('requires exactly one scheduling mode', async () => {
    await expect(
      schedule_task({ name: 'x', action_type: 'reminder', details: 'x' })
    ).resolves.toEqual(expect.objectContaining({ success: false }))
    await expect(
      schedule_task({
        name: 'x',
        schedule: 'every hour',
        trigger_at: '2026-10-14T09:00:00+08:00',
        action_type: 'reminder',
        details: 'x',
      })
    ).resolves.toEqual(expect.objectContaining({ success: false }))
    expect(invoke).not.toHaveBeenCalled()
  })

  it('creates a one-time reminder and returns the normalized time', async () => {
    invoke.mockResolvedValue({
      success: true,
      taskId: 'task-1',
      triggerAt: '2026-10-14T01:00:00.000Z',
      localTimeZone: 'Asia/Shanghai',
    })
    const result = await schedule_task({
      name: 'Tea',
      trigger_at: '2026-10-14T09:00:00+08:00',
      action_type: 'reminder',
      details: 'Drink tea',
    })
    expect(invoke).toHaveBeenCalledWith(
      'scheduler:create-task',
      expect.objectContaining({ scheduleType: 'once', cronExpression: '' })
    )
    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          taskId: 'task-1',
          triggerAt: '2026-10-14T01:00:00.000Z',
          localTimeZone: 'Asia/Shanghai',
        }),
      })
    )
  })

  it('does not permit commands in one-time mode', async () => {
    await expect(
      schedule_task({
        name: 'Unsafe',
        trigger_at: '2026-10-14T09:00:00+08:00',
        action_type: 'command',
        details: 'echo no',
      })
    ).resolves.toEqual(
      expect.objectContaining({ success: false, error: expect.stringContaining('reminders') })
    )
    expect(invoke).not.toHaveBeenCalled()
  })
})
