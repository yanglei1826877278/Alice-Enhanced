import { describe, expect, it, vi } from 'vitest'
import { createReminderHandler } from '../reminderHandler'
import type { ReminderHandlerDependencies } from '../reminderHandler'

function setup() {
  let storedHandler: ((data: any) => void) | null = null
  let storedAgentStatusHandler: ((data: any) => void) | null = null
  const unsubscribe = vi.fn()
  const unsubscribeAgentStatus = vi.fn()

  const deps: ReminderHandlerDependencies = {
    subscribe: handler => {
      storedHandler = handler
      return unsubscribe
    },
    subscribeAgentStatus: handler => {
      storedAgentStatusHandler = handler
      return unsubscribeAgentStatus
    },
    addMessage: vi.fn(),
    enqueueSpeech: vi.fn().mockResolvedValue(undefined),
    logInfo: vi.fn(),
    logError: vi.fn(),
  }

  const handler = createReminderHandler(deps)

  return {
    deps,
    handler,
    trigger: (data: any) => storedHandler?.(data),
    triggerAgentStatus: (data: any) => storedAgentStatusHandler?.(data),
    unsubscribe,
    unsubscribeAgentStatus,
  }
}

describe('createReminderHandler', () => {
  it('adds reminder message and enqueues speech', async () => {
    const { deps, trigger } = setup()

    await trigger?.({
      message: 'Time for a break',
      taskName: 'Break',
      timestamp: 'now',
    })

    expect(deps.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'assistant',
        content: [
          expect.objectContaining({
            text: 'Time for a break',
            isScheduledReminder: true,
            taskName: 'Break',
          }),
        ],
      })
    )
    expect(deps.enqueueSpeech).toHaveBeenCalledWith('Time for a break')
  })

  it('deduplicates the same scheduler delivery', async () => {
    const { deps, trigger } = setup()
    const delivery = {
      taskId: 'once-1',
      message: 'Only once',
      timestamp: '2026-10-14T01:00:00.000Z',
    }
    await trigger(delivery)
    await trigger(delivery)
    expect(deps.addMessage).toHaveBeenCalledTimes(1)
    expect(deps.enqueueSpeech).toHaveBeenCalledTimes(1)
  })

  it('skips speech when message is empty', async () => {
    const { deps, trigger } = setup()
    await trigger?.({ message: '   ' })
    expect(deps.enqueueSpeech).not.toHaveBeenCalled()
  })

  it('logs non-abort errors', async () => {
    const { deps, trigger } = setup()
    deps.enqueueSpeech = vi.fn().mockRejectedValue(new Error('fail'))

    await trigger?.({ message: 'Hello' })

    expect(deps.logError).toHaveBeenCalledWith(
      '[ReminderHandler] Failed to deliver scheduler reminder:',
      expect.any(Error)
    )
  })

  it('unsubscribes when disposed', () => {
    const { handler, unsubscribe, unsubscribeAgentStatus } = setup()
    handler.dispose()
    expect(unsubscribe).toHaveBeenCalled()
    expect(unsubscribeAgentStatus).toHaveBeenCalled()
  })

  it('injects delegated task status without speech or another model call', () => {
    const { deps, triggerAgentStatus } = setup()
    triggerAgentStatus({
      taskId: 'task-1',
      status: 'completed',
      message: 'Delegated task completed.',
      timestamp: 'now',
    })
    expect(deps.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'system',
        content: [expect.objectContaining({ text: 'Delegated task completed.' })],
      })
    )
    expect(deps.enqueueSpeech).not.toHaveBeenCalled()
  })
})

