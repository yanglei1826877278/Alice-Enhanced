import type { AudioState } from '../../stores/generalStore'
import { isExpectedAbortError } from '../../utils/isAbortError'

export interface SpeechQueueDependencies {
  createAbortController(): AbortController
  setTtsAbortController(controller: AbortController | null): void
  ttsStream(text: string, signal: AbortSignal): Promise<Response>
  queueAudioForPlayback(response: Response): boolean
  getAudioState(): AudioState
  setAudioState(state: AudioState): void
  logError(...args: any[]): void
}

export interface SpeechQueueManager {
  enqueueSpeech(text: string): Promise<void>
  getPendingCount(): number
  cancelPending(): void
  dispose(): void
}

export function createSpeechQueueManager(
  dependencies: SpeechQueueDependencies
): SpeechQueueManager {
  type PendingSpeech = {
    text: string
    resolve: () => void
  }

  const pendingSpeech: PendingSpeech[] = []
  let activeController: AbortController | null = null
  let isProcessing = false
  let generation = 0

  const processQueue = async () => {
    if (isProcessing) return
    isProcessing = true

    try {
      while (pendingSpeech.length > 0) {
        const item = pendingSpeech.shift()!
        const itemGeneration = generation
        const abortController = dependencies.createAbortController()
        activeController = abortController
        dependencies.setTtsAbortController(abortController)

        try {
          const ttsResponse = await dependencies.ttsStream(
            item.text,
            abortController.signal
          )

          // A provider may resolve after cancellation. Generation checking also
          // prevents an old turn from speaking after a new queue has started.
          if (
            abortController.signal.aborted ||
            itemGeneration !== generation
          ) {
            continue
          }

          const enqueued = dependencies.queueAudioForPlayback(ttsResponse)
          if (enqueued && dependencies.getAudioState() !== 'SPEAKING') {
            dependencies.setAudioState('SPEAKING')
          }
        } catch (error: any) {
          if (
            !abortController.signal.aborted &&
            !isExpectedAbortError(error)
          ) {
            dependencies.logError('TTS stream creation failed:', error)
          }
        } finally {
          if (activeController === abortController) {
            activeController = null
            dependencies.setTtsAbortController(null)
          }
          item.resolve()
        }
      }
    } finally {
      isProcessing = false
      // A sentence can be queued between the final loop check and this block.
      if (pendingSpeech.length > 0) void processQueue()
    }
  }

  const cancelPending = () => {
    generation += 1
    const queued = pendingSpeech.splice(0)
    for (const item of queued) item.resolve()
    activeController?.abort()
    activeController = null
    dependencies.setTtsAbortController(null)
  }

  return {
    async enqueueSpeech(text: string): Promise<void> {
      if (!text.trim()) return
      return new Promise(resolve => {
        pendingSpeech.push({ text, resolve })
        void processQueue()
      })
    },
    getPendingCount: () => pendingSpeech.length + (isProcessing ? 1 : 0),
    cancelPending,
    dispose: cancelPending,
  }
}
