import { nextTick, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import eventBus from '../utils/eventBus'
import { isExpectedAbortError } from '../utils/isAbortError'
import type { ChatMessage } from '../types/chat'
import { createHistoryManager } from '../modules/conversation/historyManager'
import { useCustomAvatarsStore } from './customAvatarsStore'

export type AudioState =
  | 'IDLE'
  | 'LISTENING'
  | 'PROCESSING_AUDIO'
  | 'WAITING_FOR_RESPONSE'
  | 'SPEAKING'
  | 'CONFIG'
  | 'GENERATING_IMAGE'

export type AgentProgressPhase =
  | 'idle'
  | 'sending'
  | 'waiting'
  | 'connected'
  | 'reasoning'
  | 'responding'
  | 'tool'

export type PendingUserInputState = 'none' | 'queued' | 'review'

export const useGeneralStore = defineStore('general', () => {
  const customAvatarsStore = useCustomAvatarsStore()
  const audioState = ref<AudioState>('IDLE')
  const isRecordingRequested = ref<boolean>(false)
  const isTTSEnabled = ref<boolean>(true)
  const recognizedText = ref<string>('')
  const chatHistory = ref<ChatMessage[]>([])
  const historyManager = createHistoryManager(chatHistory)
  const {
    addMessageToHistory,
    updateMessageApiIdByTempId,
    appendMessageDeltaByTempId,
    addContentPartToMessageByTempId,
    updateImageContentPartByGenerationId,
    updateMessageContentByTempId,
    updateMessageApiResponseIdByTempId,
    addToolCallToMessageByTempId,
    updateMessageToolCallsByTempId,
  } = historyManager
  const chatInput = ref<string>('')
  const statusMessage = ref<string>('Stand by')
  const agentProgressPhase = ref<AgentProgressPhase>('idle')
  const agentProgressDetail = ref<string>('')
  const agentProgressStartedAt = ref<number | null>(null)
  const agentProgressUpdatedAt = ref<number | null>(null)
  const pendingUserInput = ref<string>('')
  const pendingUserInputState = ref<PendingUserInputState>('none')
  const agentStopRequested = ref(false)
  let agentProgressTimer: ReturnType<typeof setInterval> | null = null
  const openSidebar = ref<boolean>(false)
  const isMinimized = ref<boolean>(false)
  const takingScreenShot = ref<boolean>(false)
  const audioPlayer = ref<HTMLAudioElement | null>(null)
  const aiVideo = ref<HTMLVideoElement | null>(null)
  const avatarFallbackImage = ref<string | null>(null)
  const avatarFallbackVideoState = ref<'standby' | 'thinking' | 'speaking'>(
    'standby'
  )
  const mediaReadyStateThreshold =
    typeof HTMLMediaElement !== 'undefined'
      ? HTMLMediaElement.HAVE_CURRENT_DATA
      : 2
  const videoSource = ref<string>(
    customAvatarsStore.builtInAvatar.stateVideos.standby
  )
  const audioQueue = ref<Response[]>([])
  const sideBarView = ref<string>('chat')
  const attachedFiles = ref<File[]>([])
  const awaitingWakeWord = ref<boolean>(false)
  const wakeWordDetected = ref<boolean>(false)

  const refreshAgentProgressMessage = () => {
    if (
      agentProgressPhase.value === 'idle' ||
      agentProgressStartedAt.value === null
    ) {
      return
    }
    const elapsedSeconds = Math.max(
      0,
      Math.floor((Date.now() - agentProgressStartedAt.value) / 1000)
    )
    const labels: Record<Exclude<AgentProgressPhase, 'idle'>, string> = {
      sending: 'Sending request',
      waiting: 'Waiting for server',
      connected: 'Connected · waiting for model',
      reasoning: 'Model reasoning',
      responding: 'Generating response',
      tool: agentProgressDetail.value
        ? `Running tool: ${agentProgressDetail.value}`
        : 'Running tool',
    }
    statusMessage.value = `${labels[agentProgressPhase.value]} · ${elapsedSeconds}s`
  }

  const startAgentProgress = (phase: AgentProgressPhase = 'sending') => {
    if (agentProgressTimer) clearInterval(agentProgressTimer)
    const now = Date.now()
    agentProgressPhase.value = phase
    agentProgressDetail.value = ''
    agentProgressStartedAt.value = now
    agentProgressUpdatedAt.value = now
    refreshAgentProgressMessage()
    agentProgressTimer = setInterval(refreshAgentProgressMessage, 1000)
  }

  const updateAgentProgress = (
    phase?: Exclude<AgentProgressPhase, 'idle'>,
    detail = ''
  ) => {
    if (agentProgressPhase.value === 'idle') return
    if (phase) agentProgressPhase.value = phase
    agentProgressDetail.value = detail
    agentProgressUpdatedAt.value = Date.now()
    refreshAgentProgressMessage()
  }

  const finishAgentProgress = () => {
    if (agentProgressTimer) clearInterval(agentProgressTimer)
    agentProgressTimer = null
    agentProgressPhase.value = 'idle'
    agentProgressDetail.value = ''
    agentProgressStartedAt.value = null
    agentProgressUpdatedAt.value = null
  }

  const queuePendingUserInput = (text: string) => {
    const normalized = text.trim()
    if (!normalized) return
    pendingUserInput.value = pendingUserInput.value.trim()
      ? `${pendingUserInput.value.trim()}\n\n${normalized}`
      : normalized
    pendingUserInputState.value = 'queued'
  }

  const consumeQueuedUserInput = (): string => {
    if (pendingUserInputState.value !== 'queued') return ''
    const value = pendingUserInput.value.trim()
    pendingUserInput.value = ''
    pendingUserInputState.value = 'none'
    return value
  }

  const hasQueuedUserInput = () =>
    pendingUserInputState.value === 'queued' &&
    pendingUserInput.value.trim().length > 0

  const markPendingUserInputForReview = () => {
    if (pendingUserInput.value.trim()) {
      pendingUserInputState.value = 'review'
    }
  }

  const clearPendingUserInput = () => {
    pendingUserInput.value = ''
    pendingUserInputState.value = 'none'
  }

  const requestAgentStop = () => {
    agentStopRequested.value = true
  }

  const consumeAgentStopRequest = (): boolean => {
    const requested = agentStopRequested.value
    agentStopRequested.value = false
    return requested
  }

  const setAudioState = (newState: AudioState) => {
    if (audioState.value === newState) return
    audioState.value = newState
    switch (newState) {
      case 'IDLE':
        statusMessage.value = isRecordingRequested.value
          ? 'Mic Ready'
          : 'Stand by'
        break
      case 'LISTENING':
        statusMessage.value = awaitingWakeWord.value
          ? 'Waiting for wake word...'
          : 'Listening...'
        break
      case 'PROCESSING_AUDIO':
        statusMessage.value = 'Processing audio...'
        break
      case 'WAITING_FOR_RESPONSE':
        if (agentProgressPhase.value === 'idle') {
          statusMessage.value = 'Thinking...'
        } else {
          refreshAgentProgressMessage()
        }
        break
      case 'SPEAKING':
        statusMessage.value = 'Speaking...'
        break
      case 'CONFIG':
        statusMessage.value = 'Setting up...'
        break
      case 'GENERATING_IMAGE':
        statusMessage.value = 'Creating image...'
        break
      default:
        statusMessage.value = 'Unknown state'
        break
    }
    if (agentProgressPhase.value !== 'idle') {
      refreshAgentProgressMessage()
    }
  }

  const getVideoForState = (state: AudioState) => {
    const activeAvatar = customAvatarsStore.activeAvatar
    switch (state) {
      case 'SPEAKING':
        return activeAvatar.stateVideos.speaking
      case 'PROCESSING_AUDIO':
      case 'WAITING_FOR_RESPONSE':
      case 'GENERATING_IMAGE':
        return activeAvatar.stateVideos.thinking
      case 'CONFIG':
        return (
          activeAvatar.stateVideos.config ||
          customAvatarsStore.builtInAvatar.stateVideos.config ||
          activeAvatar.stateVideos.standby
        )
      case 'LISTENING':
      case 'IDLE':
      default:
        return activeAvatar.stateVideos.standby
    }
  }

  // Cache the current frame so the avatar circle never flashes empty between state swaps.
  const captureCurrentVideoFrame = (): string | null => {
    if (typeof document === 'undefined') return null
    if (!aiVideo.value) return null
    const videoEl = aiVideo.value
    const width = videoEl.videoWidth
    const height = videoEl.videoHeight
    if (!width || !height) return null

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) return null

    try {
      context.drawImage(videoEl, 0, 0, width, height)
      return canvas.toDataURL('image/jpeg', 0.85)
    } catch (error) {
      // External avatar videos can taint the canvas; the fallback frame is
      // optional, so avoid flooding the console on every audio state change.
      if (!(error instanceof DOMException && error.name === 'SecurityError')) {
        console.warn('Failed to capture avatar frame:', error)
      }
      return null
    }
  }

  const updateAvatarFallbackImage = () => {
    const frame = captureCurrentVideoFrame()
    if (frame) {
      avatarFallbackImage.value = frame
      avatarFallbackVideoState.value = displayedVideoState
    }
  }

  let videoSyncVersion = 0
  let displayedVideoState: 'standby' | 'thinking' | 'speaking' = 'standby'
  const syncVideoSource = async (state: AudioState, captureFallback = true) => {
    const syncVersion = ++videoSyncVersion
    const newSource = getVideoForState(state)
    const nextVideoState =
      state === 'SPEAKING'
        ? 'speaking'
        : state === 'PROCESSING_AUDIO' ||
            state === 'WAITING_FOR_RESPONSE' ||
            state === 'GENERATING_IMAGE'
          ? 'thinking'
          : 'standby'
    if (!aiVideo.value) {
      videoSource.value = newSource
      displayedVideoState = nextVideoState
      return
    }
    if (videoSource.value !== newSource) {
      if (captureFallback) updateAvatarFallbackImage()
      videoSource.value = newSource
      displayedVideoState = nextVideoState
    }
    await nextTick()
    if (
      syncVersion !== videoSyncVersion ||
      !aiVideo.value ||
      videoSource.value !== newSource
    )
      return
    // Vue updates src, which already loads the video. Calling load() here
    // cancels the browser's pending autoplay/play request and restarts it.
    aiVideo.value.muted = true
    aiVideo.value.loop = true
    aiVideo.value.play().catch(error => {
      if (!isExpectedAbortError(error)) {
        console.warn('Video play failed:', error)
      }
    })
  }

  const handleVideoLoadedData = () => {
    updateAvatarFallbackImage()
  }

  watch(
    aiVideo,
    (newVideo, oldVideo) => {
      oldVideo?.removeEventListener('loadeddata', handleVideoLoadedData)
      if (newVideo) {
        newVideo.addEventListener('loadeddata', handleVideoLoadedData)
        if (newVideo.readyState >= mediaReadyStateThreshold) {
          updateAvatarFallbackImage()
        }
        syncVideoSource(audioState.value, false)
      }
    },
    { immediate: true }
  )

  watch(
    audioState,
    newState => {
      syncVideoSource(newState)
    },
    { immediate: true }
  )

  watch(
    () => customAvatarsStore.activeAvatar,
    () => {
      avatarFallbackImage.value = null
      syncVideoSource(audioState.value, false)
    },
    { flush: 'post' }
  )

  customAvatarsStore.ensureInitialized().catch(error => {
    console.warn('Failed to initialize custom avatars store:', error)
  })

  const queueAudioForPlayback = (audioResponse: Response): boolean => {
    if (!isTTSEnabled.value) return false
    if (!audioResponse || audioResponse.status === 204) return false
    audioQueue.value.push(audioResponse)
    return true
  }

  const stopPlaybackAndClearQueue = () => {
    eventBus.emit('cancel-tts')
    if (audioPlayer.value) {
      audioPlayer.value.pause()
      if (audioPlayer.value.src && audioPlayer.value.src.startsWith('blob:')) {
        URL.revokeObjectURL(audioPlayer.value.src)
      }
      audioPlayer.value.src = ''
      audioPlayer.value.onended = null
      audioPlayer.value.onerror = null
    }
    audioQueue.value = []
  }

  return {
    audioState,
    isRecordingRequested,
    isTTSEnabled,
    recognizedText,
    chatHistory,
    chatInput,
    statusMessage,
    openSidebar,
    isMinimized,
    takingScreenShot,
    audioPlayer,
    aiVideo,
    videoSource,
    avatarFallbackImage,
    avatarFallbackVideoState,
    audioQueue,
    sideBarView,
    attachedFiles,
    agentProgressPhase,
    agentProgressDetail,
    agentProgressStartedAt,
    agentProgressUpdatedAt,
    pendingUserInput,
    pendingUserInputState,
    agentStopRequested,
    startAgentProgress,
    updateAgentProgress,
    finishAgentProgress,
    queuePendingUserInput,
    consumeQueuedUserInput,
    hasQueuedUserInput,
    markPendingUserInputForReview,
    clearPendingUserInput,
    requestAgentStop,
    consumeAgentStopRequest,
    awaitingWakeWord,
    wakeWordDetected,
    setAudioState,
    queueAudioForPlayback,
    addMessageToHistory,
    updateMessageApiIdByTempId,
    appendMessageDeltaByTempId,
    addContentPartToMessageByTempId,
    updateImageContentPartByGenerationId,
    updateMessageContentByTempId,
    updateMessageApiResponseIdByTempId,
    addToolCallToMessageByTempId,
    updateMessageToolCallsByTempId,
    stopPlaybackAndClearQueue,
  }
})
