<template>
  <div class="h-screen flex w-full items-center justify-start relative">
    <div
      class="avatar-wrapper flex container h-full items-center justify-center relative z-2"
      :class="{ mini: isMinimized }"
    >
      <div class="avatar" :class="{ open: openSidebar }">
        <div
          class="avatar-ring alice-avatar-viewport"
          :style="avatarRingStyle"
          :class="{
            'ring-green-500!': visualActivityState === 'SPEAKING',
            'ring-cyan-500!':
              visualActivityState === 'PROCESSING_AUDIO' ||
              visualActivityState === 'WAITING_FOR_RESPONSE',
            'ring-blue-500!': visualActivityState === 'LISTENING',
            'w-[200px] h-[200px]': isMinimized,
            'w-[480px] h-[480px]': !isMinimized && isElectron,
            'w-[430px] h-[430px]': !isElectron,
          }"
        >
          <audio ref="audioPlayerElement" class="hidden"></audio>
          <div class="alice-avatar-video-clip">
            <video
              :style="avatarVideoStyle"
              @loadedmetadata="updateAvatarAspect"
              @loadeddata="revealAvatarVideo"
              @canplay="resumeAvatarVideo"
              @error="handleAvatarVideoError"
              ref="aiVideoElement"
              :src="videoSource"
              loop
              muted
              autoplay
              playsinline
            ></video>
          </div>
          <div
            class="alice-avatar-drag-surface window-drag-area"
            aria-hidden="true"
          ></div>
          <Actions
            @takeScreenShot="handleTakeScreenshot"
            @togglePlaying="handleToggleTTS"
            @toggleRecording="handleToggleRecording"
            :isElectron="isElectron"
            :isTTSEnabled="isTTSEnabled"
            :audioState="audioState"
          />
        </div>
      </div>
      <Sidebar @processRequest="processRequestFromSidebar" />
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  computed,
  nextTick,
  onMounted,
  onUnmounted,
  ref as vueRef,
  watch,
} from 'vue'
import type { CSSProperties } from 'vue'
import { storeToRefs } from 'pinia'
import Actions from './Actions.vue'
import Sidebar from './Sidebar.vue'

import { useGeneralStore } from '../stores/generalStore'
import { useConversationStore } from '../stores/conversationStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useCustomAvatarsStore } from '../stores/customAvatarsStore'
import {
  avatarFrameDimensions,
  avatarFramingStyle,
  getAvatarFraming,
  getAvatarVideoState,
} from '../utils/avatarFraming'
import {
  indexMessageForThoughts,
  uploadFileToOpenAI,
} from '../services/apiService'
import type { ChatMessage, AppChatMessageContentPart } from '../types/chat'
import { useAudioProcessing } from '../composables/useAudioProcessing'
import { useAudioPlayback } from '../composables/useAudioPlayback'
import { useScreenshot } from '../composables/useScreenshot'
import eventBus from '../utils/eventBus'
import {
  composeVoiceRequest,
  consumeCapturedVoiceDraft,
} from '../utils/voiceDraft'
import {
  getChatAttachmentKind,
  getChatImageMimeType,
  validateChatAttachment,
} from '../utils/chatAttachments'
import { isExplicitVoiceStopRequest } from '../utils/voiceInterruption'

const audioProcessing = useAudioProcessing()
const { toggleRecordingRequest } = audioProcessing
const { toggleTTSPreference } = useAudioPlayback()
const {
  screenShot,
  screenshotReady,
  takeScreenShot,
  setupScreenshotListeners,
  cleanupScreenshotListeners,
} = useScreenshot()

const generalStore = useGeneralStore()
const conversationStore = useConversationStore()

const {
  audioState,
  aiVideo,
  videoSource,
  audioPlayer,
  chatInput,
  openSidebar,
  isMinimized,
  isTTSEnabled,
  isRecordingRequested,
  takingScreenShot,
  avatarFallbackImage,
  avatarFallbackVideoState,
  agentProgressPhase,
} = storeToRefs(generalStore)
const { setAudioState } = generalStore

const isElectron =
  typeof window !== 'undefined' && Boolean((window as any).electron)
const audioPlayerElement = vueRef<HTMLAudioElement | null>(null)
const aiVideoElement = vueRef<HTMLVideoElement | null>(null)
const avatarAspect = vueRef(1)
const avatarVideoReady = vueRef(false)
let avatarRevealVersion = 0
const avatarSettings = useSettingsStore()
const avatarLibrary = useCustomAvatarsStore()
const visualActivityState = computed(() =>
  agentProgressPhase.value !== 'idle' && audioState.value !== 'SPEAKING'
    ? ('WAITING_FOR_RESPONSE' as const)
    : audioState.value
)
const avatarVideoStyle = computed<CSSProperties>(() => ({
  ...avatarFramingStyle(
    getAvatarFraming(
      avatarSettings.settings.avatarFraming,
      avatarLibrary.activeAvatar.id,
      getAvatarVideoState(visualActivityState.value)
    ),
    avatarAspect.value
  ),
  opacity: avatarVideoReady.value ? 1 : 0,
  transition: 'opacity 120ms ease-out',
}))

watch(
  videoSource,
  () => {
    // Keep the captured frame visible while Chromium decodes the new source.
    avatarRevealVersion += 1
    avatarVideoReady.value = false
  },
  { flush: 'sync' }
)

const updateAvatarAspect = (event: Event) => {
  const video = event.target as HTMLVideoElement
  avatarAspect.value = video.videoWidth / video.videoHeight || 1
}
const revealAvatarVideo = (event: Event) => {
  const video = event.target as HTMLVideoElement
  const revealVersion = avatarRevealVersion

  updateAvatarAspect(event)
  // loadeddata means the first frame exists. Waiting for the next paint keeps
  // the video element from exposing its black decoder surface during a swap.
  requestAnimationFrame(() => {
    if (
      revealVersion === avatarRevealVersion &&
      video === aiVideoElement.value &&
      video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
    ) {
      avatarVideoReady.value = true
    }
  })
}
const resumeAvatarVideo = (event: Event) => {
  const video = event.target as HTMLVideoElement
  if (!video.paused) return
  video.muted = true
  void video.play().catch(error => {
    if (error?.name !== 'AbortError')
      console.warn('Avatar playback failed:', error)
  })
}
const handleAvatarVideoError = (event: Event) => {
  const video = event.target as HTMLVideoElement
  avatarVideoReady.value = false
  console.warn(
    'Avatar video failed to load:',
    video.error?.code,
    video.currentSrc
  )
  generalStore.statusMessage =
    '角色视频无法播放，请检查文件是否存在及 MP4 编码。'
}

let isProcessingRequest = false
const MODEL_IDLE_TIMEOUT_MS = 120_000

const avatarRingStyle = computed<CSSProperties>(() => {
  const style: CSSProperties = {
    backgroundColor: '#050505',
    width: `${isMinimized.value ? 200 : isElectron ? 480 : 430}px`,
    height: `${isMinimized.value ? 200 : isElectron ? 480 : 430}px`,
    position: 'relative',
    flexShrink: 0,
    borderRadius: '50%',
    overflow: 'hidden',
  }
  if (avatarFallbackImage.value) {
    const frame = getAvatarFraming(
      avatarSettings.settings.avatarFraming,
      avatarLibrary.activeAvatar.id,
      avatarFallbackVideoState.value
    )
    const dimensions = avatarFrameDimensions(frame, avatarAspect.value)
    style.backgroundImage = `url(${avatarFallbackImage.value})`
    style.backgroundSize = `${dimensions.width * 100}% ${dimensions.height * 100}%`
    style.backgroundPosition = `${50 - frame.x * 50}% ${50 - frame.y * 50}%`
    style.backgroundRepeat = 'no-repeat'
  }
  return style
})

onMounted(async () => {
  audioPlayer.value = audioPlayerElement.value
  aiVideo.value = aiVideoElement.value

  if (isElectron) {
    setupScreenshotListeners()
  }

  eventBus.on('processing-complete', handleProcessingComplete)
  eventBus.on('mute-playback-toggle', handleToggleTTS)
  eventBus.on('take-screenshot', handleTakeScreenshot)
})

onUnmounted(() => {
  if (isElectron) {
    cleanupScreenshotListeners()
  }
  aiVideo.value = null
  eventBus.off('processing-complete', handleProcessingComplete)
  eventBus.off('mute-playback-toggle', handleToggleTTS)
  eventBus.off('take-screenshot', handleTakeScreenshot)
})

const handleTakeScreenshot = () => {
  if (isElectron && !takingScreenShot.value) {
    takeScreenShot()
  }
}

const handleToggleTTS = () => {
  toggleTTSPreference()
}

const handleToggleRecording = () => {
  toggleRecordingRequest()
}

const handleProcessingComplete = (transcription: string) => {
  const meaningfulTranscription =
    transcription && transcription.trim().length > 1

  if (isProcessingRequest) {
    if (!meaningfulTranscription) return
    if (isExplicitVoiceStopRequest(transcription)) {
      generalStore.requestAgentStop()
      eventBus.emit('cancel-llm-stream')
      generalStore.stopPlaybackAndClearQueue()
      generalStore.updateAgentProgress('tool', 'waiting to stop safely')
      setAudioState(isRecordingRequested.value ? 'LISTENING' : 'IDLE')
      return
    }

    const draftSnapshot = chatInput.value
    const pendingText = composeVoiceRequest(transcription, draftSnapshot)
    generalStore.queuePendingUserInput(pendingText)
    generalStore.recognizedText = transcription
    chatInput.value = consumeCapturedVoiceDraft(chatInput.value, draftSnapshot)
    setAudioState(isRecordingRequested.value ? 'LISTENING' : 'IDLE')
    return
  }

  if (
    meaningfulTranscription &&
    (audioState.value === 'PROCESSING_AUDIO' ||
      audioState.value === 'LISTENING')
  ) {
    const draftSnapshot = chatInput.value
    const capturedRequest = composeVoiceRequest(transcription, draftSnapshot)
    const pendingReview =
      generalStore.pendingUserInputState === 'review'
        ? generalStore.pendingUserInput.trim()
        : ''
    const requestText = [pendingReview, capturedRequest]
      .filter(Boolean)
      .join('\n\n')
    if (pendingReview) generalStore.clearPendingUserInput()
    generalStore.recognizedText = transcription
    void processRequest(requestText, 'VOICE', draftSnapshot)
  } else {
    if (
      audioState.value !== 'SPEAKING' &&
      audioState.value !== 'WAITING_FOR_RESPONSE'
    ) {
      setAudioState(isRecordingRequested.value ? 'LISTENING' : 'IDLE')
    }
  }
}

const processRequestFromSidebar = (text: string) => {
  if (isProcessingRequest) {
    generalStore.queuePendingUserInput(text)
    return
  }
  if (text.trim() || generalStore.attachedFiles.length) {
    if (
      audioState.value === 'IDLE' ||
      audioState.value === 'LISTENING' ||
      audioState.value === 'WAITING_FOR_RESPONSE' ||
      audioState.value === 'SPEAKING'
    ) {
      generalStore.recognizedText = ''
      processRequest(text, 'SIDEBAR_TEXT')
    } else {
      generalStore.statusMessage = 'Busy, please wait...'

      setTimeout(() => {
        if (generalStore.statusMessage === 'Busy, please wait...')
          generalStore.setAudioState(audioState.value)
      }, 2000)
    }
  }
}

const readImageAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        const imageMimeType = getChatImageMimeType(file)
        if (!imageMimeType) {
          reject(new Error('Unsupported image format.'))
          return
        }
        resolve(
          reader.result.replace(/^data:[^;]+;/i, `data:${imageMimeType};`)
        )
      } else {
        reject(new Error('The selected image could not be read.'))
      }
    }
    reader.onerror = () =>
      reject(reader.error || new Error('The selected image could not be read.'))
    reader.readAsDataURL(file)
  })

const processRequest = async (
  text: string,
  source: 'VOICE' | 'SIDEBAR_TEXT',
  voiceDraftSnapshot?: string
) => {
  if (isProcessingRequest) {
    return
  }
  isProcessingRequest = true
  generalStore.consumeAgentStopRequest()
  generalStore.startAgentProgress('sending')

  // Starting a new turn must invalidate synthesized audio from the previous
  // turn, including sentences that have not reached the playback queue yet.
  generalStore.stopPlaybackAndClearQueue()
  setAudioState('WAITING_FOR_RESPONSE')

  const appContentParts: AppChatMessageContentPart[] = []

  const filesToProcess = [...generalStore.attachedFiles]
  if (filesToProcess.length) {
    for (const file of filesToProcess) {
      const validationError = validateChatAttachment(file)
      if (validationError) {
        generalStore.statusMessage = `Error: ${file.name}: ${validationError}`
        isProcessingRequest = false
        generalStore.finishAgentProgress()
        setAudioState(isRecordingRequested.value ? 'LISTENING' : 'IDLE')
        generalStore.attachedFiles = []
        return
      }
    }

    const containsPdf = filesToProcess.some(
      file => getChatAttachmentKind(file) === 'pdf'
    )
    generalStore.statusMessage = containsPdf
      ? `Uploading ${filesToProcess.length} attachment(s)...`
      : `Preparing ${filesToProcess.length} image(s)...`
    try {
      const attachmentParts = await Promise.all(
        filesToProcess.map(async (file): Promise<AppChatMessageContentPart> => {
          if (getChatAttachmentKind(file) === 'image') {
            return {
              type: 'app_image_uri',
              uri: await readImageAsDataUrl(file),
            }
          }

          const uploadedFileId = await uploadFileToOpenAI(file)
          if (!uploadedFileId) {
            throw new Error(`${file.name} upload failed.`)
          }
          return {
            type: 'app_file',
            fileId: uploadedFileId,
            fileName: file.name,
          }
        })
      )
      appContentParts.push(...attachmentParts)
    } catch (error) {
      console.error('Error preparing attachment:', error)
      generalStore.statusMessage = `Error: ${
        error instanceof Error
          ? error.message
          : 'Attachment could not be prepared.'
      }`
      isProcessingRequest = false
      generalStore.finishAgentProgress()
      setAudioState(isRecordingRequested.value ? 'LISTENING' : 'IDLE')
      generalStore.attachedFiles = []
      return
    }
    generalStore.attachedFiles = []
  }

  if (text) {
    appContentParts.push({ type: 'app_text', text: text })
  }

  if (screenshotReady.value && screenShot.value) {
    appContentParts.push({ type: 'app_image_uri', uri: screenShot.value })
    screenshotReady.value = false
    screenShot.value = ''
  }

  if (appContentParts.length === 0) {
    generalStore.statusMessage = 'Nothing to send.'
    isProcessingRequest = false
    generalStore.finishAgentProgress()
    setAudioState(isRecordingRequested.value ? 'LISTENING' : 'IDLE')
    return
  }

  const userMessage: ChatMessage = {
    role: 'user',
    content: appContentParts,
  }

  const userTextForIndexing = appContentParts
    .filter(part => part.type === 'app_text' && part.text)
    .map(part => part.text!)
    .join(' ')
  const hasImageForIndexing = appContentParts.some(
    part => part.type === 'app_image_uri' && part.uri
  )
  const conversationIdForThought = conversationStore.currentConversationId
  const indexingContent = appContentParts.map(part => ({ ...part }))

  // Render the user's message before any network-bound memory work starts.
  generalStore.addMessageToHistory(userMessage)
  if (source === 'VOICE' && voiceDraftSnapshot !== undefined) {
    chatInput.value = consumeCapturedVoiceDraft(
      chatInput.value,
      voiceDraftSnapshot
    )
  }
  await nextTick()
  let idleTimedOut = false
  try {
    const chatPromise = conversationStore.chat()

    // Index only after this turn settles so the current prompt cannot be
    // retrieved as if it were an older memory. Indexing remains non-blocking.
    if (
      conversationStore.currentMemoryMode !== 'temporary' &&
      (userTextForIndexing || hasImageForIndexing)
    ) {
      void chatPromise.then(
        () =>
          indexMessageForThoughts(conversationIdForThought, 'user', {
            content: indexingContent,
          }).catch(error => {
            console.error(
              '[Main.vue] Error indexing user message in background:',
              error
            )
          }),
        () => undefined
      )
    }

    const timeoutPromise = new Promise<never>((_, reject) => {
      const intervalId = setInterval(() => {
        if (generalStore.audioState === 'GENERATING_IMAGE') return
        const lastActivity = generalStore.agentProgressUpdatedAt || Date.now()
        if (Date.now() - lastActivity < MODEL_IDLE_TIMEOUT_MS) return

        idleTimedOut = true
        eventBus.emit('cancel-llm-stream')
        reject(
          new Error(
            `Model stream produced no activity for ${MODEL_IDLE_TIMEOUT_MS / 1000} seconds.`
          )
        )
      }, 1000)

      const stopTimeout = () => {
        clearInterval(intervalId)
      }
      void chatPromise.then(stopTimeout, stopTimeout)
    })

    await Promise.race([chatPromise, timeoutPromise])
  } catch (e) {
    console.error(
      `[Main.vue processRequest (${source})] Error during conversationStore.chat():`,
      e
    )

    if (
      generalStore.audioState !== 'IDLE' &&
      generalStore.audioState !== 'LISTENING' &&
      generalStore.audioState !== 'GENERATING_IMAGE'
    ) {
      console.log('[Error Recovery] Resetting audio state to prevent UI lock')
      setAudioState(isRecordingRequested.value ? 'LISTENING' : 'IDLE')
    }
    if (idleTimedOut) {
      generalStore.addMessageToHistory({
        role: 'system',
        content: [
          {
            type: 'app_text',
            text: '模型连接连续 120 秒没有返回任何数据，本次请求已自动取消。你可以重试，或检查代理服务状态。',
          },
        ],
      })
      generalStore.statusMessage = 'Error: Model response stalled'
    }
  } finally {
    if (generalStore.consumeAgentStopRequest()) {
      generalStore.addMessageToHistory({
        role: 'system',
        content: [
          {
            type: 'app_text',
            text: '已按你的要求停止当前回复。',
          },
        ],
      })
    }
    generalStore.markPendingUserInputForReview()
    generalStore.finishAgentProgress()
    isProcessingRequest = false

    setTimeout(() => {
      if (
        generalStore.audioState === 'WAITING_FOR_RESPONSE' ||
        generalStore.audioState === 'PROCESSING_AUDIO'
      ) {
        if (conversationStore.getPendingSpeechCount() > 0) return
        console.log(
          '[Safety Recovery] Detected stuck audio state, resetting to interactive mode'
        )
        setAudioState(isRecordingRequested.value ? 'LISTENING' : 'IDLE')
      }
    }, 2000)
  }
}
</script>

<style scoped lang="postcss">
.avatar-ring {
  transition: ring-color 0.3s ease-in-out;
}
</style>
