import { describe, expect, it, vi } from 'vitest'
import { createSpeechQueueManager } from '../speechQueue'
import type { SpeechQueueDependencies } from '../speechQueue'

function buildDependencies(
  overrides: Partial<SpeechQueueDependencies> & {
    audioState?: string
  } = {}
): SpeechQueueDependencies {
  let audioState = (overrides.audioState as any) ?? 'IDLE'
  const controller = new AbortController()

  const deps: SpeechQueueDependencies = {
    createAbortController: vi.fn(() => controller),
    setTtsAbortController: vi.fn(),
    ttsStream: vi.fn(async () => new Response('audio')),
    queueAudioForPlayback: vi.fn(() => true),
    getAudioState: vi.fn(() => audioState as any),
    setAudioState: vi.fn(state => {
      audioState = state
    }),
    logError: vi.fn(),
    ...overrides,
  }

  return deps
}

describe('createSpeechQueueManager', () => {
  it('ignores empty or whitespace only text', async () => {
    const deps = buildDependencies()
    const manager = createSpeechQueueManager(deps)

    await manager.enqueueSpeech('   ')

    expect(deps.createAbortController).not.toHaveBeenCalled()
    expect(deps.ttsStream).not.toHaveBeenCalled()
  })

  it('enqueues audio and switches to speaking state', async () => {
    const deps = buildDependencies({ audioState: 'WAITING_FOR_RESPONSE' })
    const manager = createSpeechQueueManager(deps)

    await manager.enqueueSpeech('Hello')

    expect(deps.createAbortController).toHaveBeenCalled()
    expect(deps.ttsStream).toHaveBeenCalledWith(
      'Hello',
      expect.any(AbortSignal)
    )
    expect(deps.queueAudioForPlayback).toHaveBeenCalled()
    expect(deps.setAudioState).toHaveBeenCalledWith('SPEAKING')
    expect(manager.getPendingCount()).toBe(0)
  })

  it('synthesizes queued sentences in order without starting them concurrently', async () => {
    let resolveFirst: ((response: Response) => void) | undefined
    const ttsStream = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>(resolve => {
            resolveFirst = resolve
          })
      )
      .mockResolvedValueOnce(new Response('second audio'))
    const deps = buildDependencies({ ttsStream })
    const manager = createSpeechQueueManager(deps)

    const first = manager.enqueueSpeech('First sentence.')
    const second = manager.enqueueSpeech('Second sentence.')

    expect(ttsStream).toHaveBeenCalledTimes(1)
    expect(manager.getPendingCount()).toBe(2)

    resolveFirst?.(new Response('first audio'))
    await Promise.all([first, second])

    expect(ttsStream.mock.calls.map(call => call[0])).toEqual([
      'First sentence.',
      'Second sentence.',
    ])
    expect(deps.queueAudioForPlayback).toHaveBeenCalledTimes(2)
    expect(manager.getPendingCount()).toBe(0)
  })

  it('does not change audio state when enqueue returns false', async () => {
    const deps = buildDependencies({
      queueAudioForPlayback: vi.fn(() => false),
    })
    const manager = createSpeechQueueManager(deps)

    await manager.enqueueSpeech('Hello')

    expect(deps.setAudioState).not.toHaveBeenCalled()
  })

  it.each(['AbortError', 'APIUserAbortError'])(
    'silently handles %s from TTS stream',
    async errorName => {
      const abortError = Object.assign(new Error('cancel'), {
        name: errorName,
      })
      const deps = buildDependencies({
        ttsStream: vi.fn(async () => {
          throw abortError
        }),
      })
      const manager = createSpeechQueueManager(deps)

      await manager.enqueueSpeech('Hello')

      expect(deps.logError).not.toHaveBeenCalled()
    }
  )

  it('does not enqueue a response that resolves after cancellation', async () => {
    let resolveTts: ((response: Response) => void) | undefined
    const abortController = new AbortController()
    const ttsStream = vi.fn(
      () =>
        new Promise<Response>(resolve => {
          resolveTts = resolve
        })
    )
    const deps = buildDependencies({
      createAbortController: vi.fn(() => abortController),
      ttsStream,
    })
    const manager = createSpeechQueueManager(deps)

    const pending = manager.enqueueSpeech('Hello')

    manager.cancelPending()
    resolveTts?.(new Response('audio'))

    await pending

    expect(deps.queueAudioForPlayback).not.toHaveBeenCalled()
    expect(deps.setAudioState).not.toHaveBeenCalled()
  })

  it('drops queued sentences when cancelled', async () => {
    let resolveFirst: ((response: Response) => void) | undefined
    const ttsStream = vi.fn(
      () =>
        new Promise<Response>(resolve => {
          resolveFirst = resolve
        })
    )
    const deps = buildDependencies({ ttsStream })
    const manager = createSpeechQueueManager(deps)

    const first = manager.enqueueSpeech('First')
    const second = manager.enqueueSpeech('Second')
    manager.cancelPending()
    resolveFirst?.(new Response('stale audio'))
    await Promise.all([first, second])

    expect(ttsStream).toHaveBeenCalledTimes(1)
    expect(deps.queueAudioForPlayback).not.toHaveBeenCalled()
    expect(manager.getPendingCount()).toBe(0)
  })

  it('logs other TTS errors', async () => {
    const deps = buildDependencies({
      ttsStream: vi.fn(async () => {
        throw new Error('boom')
      }),
    })
    const manager = createSpeechQueueManager(deps)

    await manager.enqueueSpeech('Hello')

    expect(deps.logError).toHaveBeenCalledWith(
      'TTS stream creation failed:',
      expect.any(Error)
    )
  })
})
