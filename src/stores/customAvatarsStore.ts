import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { CustomAvatar, CustomAvatarsSnapshot } from '../../types/customAvatars'
import videoSpeaking from '../assets/videos/speaking.mp4'
import videoStandby from '../assets/videos/standby.mp4'
import videoThinking from '../assets/videos/thinking.mp4'
import defaultAssistantChatAvatar from '../assets/images/chat-avatar-alice.webp'
import { useSettingsStore } from './settingsStore'

interface OperationResult<T> {
  success: boolean
  data?: T
  error?: string
}

const builtInAvatar: CustomAvatar = {
  id: 'alice',
  name: 'Alice',
  folderName: 'Alice',
  source: 'builtin',
  stateVideos: {
    speaking: videoSpeaking,
    standby: videoStandby,
    thinking: videoThinking,
  },
  previewVideo: videoStandby,
  chatAvatar: defaultAssistantChatAvatar,
}

export const useCustomAvatarsStore = defineStore('customAvatars', () => {
  const customAvatars = ref<CustomAvatar[]>([])
  const customizationRoot = ref('user-customization/custom-avatars')
  const isLoading = ref(false)
  const isRefreshing = ref(false)
  const isUpdatingChatAvatar = ref(false)
  const error = ref<string | null>(null)
  const initialized = ref(false)
  const lastUpdated = ref<number | null>(null)

  function mergeSnapshot(snapshot: CustomAvatarsSnapshot) {
    customAvatars.value = snapshot.avatars
    builtInAvatar.chatAvatar =
      snapshot.builtinChatAvatar || defaultAssistantChatAvatar
    customizationRoot.value = snapshot.customizationRoot
    lastUpdated.value = Date.now()
  }

  async function fetchSnapshot() {
    if (!window.customAvatarsAPI) {
      initialized.value = true
      error.value = null
      customAvatars.value = []
      return
    }

    isLoading.value = true
    error.value = null
    try {
      const response =
        (await window.customAvatarsAPI.list()) as OperationResult<CustomAvatarsSnapshot>
      if (!response.success || !response.data) {
        throw new Error(response.error || 'Unable to load custom avatars.')
      }
      mergeSnapshot(response.data)
    } catch (err: any) {
      error.value = err?.message || 'Unable to load custom avatars.'
    } finally {
      isLoading.value = false
      initialized.value = true
    }
  }

  async function ensureInitialized() {
    if (!initialized.value) {
      await fetchSnapshot()
    }
  }

  async function refresh() {
    if (!window.customAvatarsAPI) return
    if (isRefreshing.value) return
    isRefreshing.value = true
    error.value = null
    try {
      const response =
        (await window.customAvatarsAPI.refresh()) as OperationResult<CustomAvatarsSnapshot>
      if (!response.success || !response.data) {
        throw new Error(response.error || 'Unable to refresh custom avatars.')
      }
      mergeSnapshot(response.data)
    } catch (err: any) {
      error.value = err?.message || 'Unable to refresh custom avatars.'
      throw err
    } finally {
      isRefreshing.value = false
    }
  }

  async function setChatAvatar(avatarId: string, file: File) {
    if (!window.customAvatarsAPI) {
      throw new Error('Chat avatar editing is only available in the desktop app.')
    }
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      throw new Error('请选择 PNG、JPEG 或 WebP 图片。')
    }
    if (file.size <= 0 || file.size > 6 * 1024 * 1024) {
      throw new Error('聊天头像不能超过 6 MB。')
    }

    isUpdatingChatAvatar.value = true
    error.value = null
    try {
      const imageBytes = new Uint8Array(await file.arrayBuffer())
      const response = (await window.customAvatarsAPI.setChatAvatar(
        avatarId,
        imageBytes
      )) as OperationResult<CustomAvatarsSnapshot>
      if (!response.success || !response.data) {
        throw new Error(response.error || 'Unable to update chat avatar.')
      }
      mergeSnapshot(response.data)
    } catch (err: any) {
      error.value = err?.message || 'Unable to update chat avatar.'
      throw err
    } finally {
      isUpdatingChatAvatar.value = false
    }
  }

  const allAvatars = computed<CustomAvatar[]>(() => [builtInAvatar, ...customAvatars.value])

  const settingsStore = useSettingsStore()

  const activeAvatarId = computed(() => settingsStore.settings.assistantAvatar || builtInAvatar.id)

  const activeAvatar = computed<CustomAvatar>(() => {
    return (
      allAvatars.value.find(avatar => avatar.id === activeAvatarId.value) ||
      builtInAvatar
    )
  })

  const customAvatarCount = computed(() => customAvatars.value.length)

  return {
    customAvatars,
    customizationRoot,
    isLoading,
    isRefreshing,
    isUpdatingChatAvatar,
    error,
    initialized,
    lastUpdated,
    allAvatars,
    activeAvatar,
    activeAvatarId,
    customAvatarCount,
    ensureInitialized,
    fetchSnapshot,
    refresh,
    setChatAvatar,
    builtInAvatar,
    defaultAssistantChatAvatar,
  }
})
