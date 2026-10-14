<template>
  <div class="avatar-action-bar absolute bottom-0 py-2 z-40 flex flex-col w-full bg-black/60 window-no-drag">
    <div class="pb-2 rounded-lg flex items-center justify-center gap-8">
      <img
        :src="micIconSrc"
        class="indicator"
        :class="{ mini: isMinimized }"
        @click="handleMicrophoneClick"
        data-tip="Toggle Microphone"
        :aria-label="micAriaLabel"
      />
      <img
        :src="props.isTTSEnabled ? speakerIcon : speakerIconInactive"
        class="indicator"
        :class="{ mini: isMinimized }"
        @click="!isConfigState ? emit('togglePlaying') : null"
        data-tip="Toggle Speech Output"
        aria-label="Toggle Speech Output"
      />
      <button
        v-if="!isMinimized"
        type="button"
        class="action-icon-button window-no-drag"
        data-tip="Toggle Chat Panel"
        aria-label="Toggle Chat Panel"
        :aria-pressed="sideBarView === 'chat' && openSidebar"
        :disabled="isConfigState"
        @pointerdown.stop
        @click.stop="changeSidebarView('chat')"
      >
        <img :src="chatIcon" class="indicator" alt="" draggable="false" />
      </button>
    </div>
    <div
      class="status-message-container dragable select-none overflow-hidden whitespace-nowrap relative"
      :class="{
        'text-xs': isMinimized,
        'h-4': isMinimized,
        'h-6': !isMinimized,
      }"
    >
      <span
        :id="statusMessageId"
        class="status-message-text absolute"
        :class="{ 'scrolling-text': shouldScrollStatusMessage }"
        :style="statusMessageStyle"
      >
        {{ statusMessage }}
      </span>
      <span
        v-if="shouldScrollStatusMessage"
        class="status-message-text absolute scrolling-text"
        :style="statusMessageStyle"
        aria-hidden="true"
      >
        {{ statusMessage }}
      </span>
    </div>
  </div>

  <template v-if="props.isElectron">
    <div
      class="absolute w-full px-2 flex justify-between z-30 inside-actions window-no-drag"
      :class="{ 'top-[80px]': isMinimized, 'top-[220px]': !isMinimized }"
    >
      <button
        class="btn btn-circle bg-opacity-20 bg-gray-500 border-0 p-2 btn-indicator-side tooltip tooltip-right"
        data-tip="Take Screenshot"
        aria-label="Take Screenshot"
        :class="{ 'btn-sm': isMinimized }"
        @click="!isConfigState ? emit('takeScreenShot') : null"
        :disabled="takingScreenShot"
      >
        <img
          :src="cameraIcon"
          class="indicator indicator-side"
          :class="{ mini: isMinimized }"
          alt=""
        />
      </button>
      <button
        class="btn btn-circle bg-opacity-20 bg-gray-500 border-0 p-2 btn-indicator-side tooltip tooltip-left"
        :data-tip="isMinimized ? 'Maximize' : 'Minimize'"
        :aria-label="isMinimized ? 'Maximize Window' : 'Minimize Window'"
        :class="{ 'btn-sm': isMinimized }"
        @click="!isConfigState ? toggleMinimize() : null"
      >
        <img
          :src="isMinimized ? maxiIcon : miniIcon"
          class="indicator indicator-side"
          :class="{ mini: isMinimized }"
          alt=""
        />
      </button>
    </div>

    <div class="absolute w-full flex justify-center z-30 top-2 inside-actions window-no-drag">
      <div ref="applicationMenu" class="application-menu relative">
        <button
          type="button"
          aria-label="Application Menu"
          aria-haspopup="menu"
          :aria-expanded="isApplicationMenuOpen"
          class="btn btn-circle bg-opacity-20 bg-gray-500 border-0 p-2 btn-indicator-side close tooltip tooltip-bottom"
          :class="{ 'btn-sm': isMinimized }"
          @click="isApplicationMenuOpen = !isApplicationMenuOpen"
        >
          <img :src="hamburgerIcon" class="indicator indicator-side" alt="" />
        </button>
        <ul
          v-if="isApplicationMenuOpen"
          role="menu"
          class="application-menu-content menu bg-base-200 bg-opacity-80 rounded-box z-[1] w-36 p-2 shadow"
        >
          <li>
            <a @click="openApplicationSettings"
              >Settings</a
            >
          </li>
          <li><a @click="closeApplication">Close app</a></li>
        </ul>
      </div>
    </div>
  </template>
</template>

<script setup lang="ts">
import { computed, defineProps, nextTick, ref, watch, onMounted, onUnmounted } from 'vue'
import { useGeneralStore, AudioState } from '../stores/generalStore'
import { useSettingsStore } from '../stores/settingsStore'
import { storeToRefs } from 'pinia'
import {
  micIcon,
  micIconActive,
  speakerIcon,
  speakerIconInactive,
  chatIcon,
  miniIcon,
  maxiIcon,
  cameraIcon,
  hamburgerIcon,
} from '../utils/assetsImport'

const props = defineProps({
  isElectron: {
    type: Boolean,
    default: false,
  },
  isTTSEnabled: {
    type: Boolean,
    required: true,
  },
  audioState: {
    type: String as () => AudioState,
    required: true,
  },
})

const emit = defineEmits(['takeScreenShot', 'togglePlaying', 'toggleRecording'])

const generalStore = useGeneralStore()
const settingsStore = useSettingsStore()
const {
  isMinimized,
  statusMessage,
  openSidebar,
  takingScreenShot,
  sideBarView,
  isRecordingRequested,
  audioState: storeAudioState,
} = storeToRefs(generalStore)

const statusMessageId = ref(
  `status-msg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
)
const applicationMenu = ref<HTMLElement | null>(null)
const isApplicationMenuOpen = ref(false)
const minimizeBehavior = computed(() => settingsStore.settings.minimizeBehavior)

const closeApplicationMenuOnOutsideClick = (event: PointerEvent) => {
  if (!applicationMenu.value?.contains(event.target as Node)) {
    isApplicationMenuOpen.value = false
  }
}

const closeApplicationMenuOnEscape = (event: KeyboardEvent) => {
  if (event.key === 'Escape') isApplicationMenuOpen.value = false
}

const scrollSpeedFactor = 0.1
const scrollAnimationDuration = ref('10s')

const shouldScrollStatusMessage = computed(() => {
  return statusMessage.value.length > 20
})

const statusMessageStyle = computed(() => {
  if (shouldScrollStatusMessage.value) {
    return {
      'animation-duration': scrollAnimationDuration.value,
    }
  }
  return {}
})

const calculateScrollDuration = () => {
  nextTick(() => {
    const textEl = document.getElementById(statusMessageId.value)
    if (textEl && shouldScrollStatusMessage.value) {
      const textWidth = textEl.offsetWidth
      if (textWidth > 0) {
        const duration = textWidth * scrollSpeedFactor
        scrollAnimationDuration.value = `${Math.max(3, duration).toFixed(2)}s`
      } else {
        scrollAnimationDuration.value = `${(statusMessage.value.length * 0.3 * scrollSpeedFactor * 20).toFixed(2)}s`
      }
    } else if (!shouldScrollStatusMessage.value) {
      scrollAnimationDuration.value = '0s'
    }
  })
}

watch(
  statusMessage,
  () => {
    calculateScrollDuration()
  },
  { immediate: true }
)

watch(isMinimized, () => {
  calculateScrollDuration()
})

watch(minimizeBehavior, behavior => {
  if (behavior === 'taskbar' && isMinimized.value && props.isElectron) {
    isMinimized.value = false
    void nextTick(() => {
      window.electron.mini({ minimize: false, behavior: 'corner' })
    })
  }
})

const micIconSrc = computed(() => {
  return props.audioState === 'LISTENING' ||
    (isRecordingRequested.value && props.audioState !== 'IDLE')
    ? micIconActive
    : micIcon
})

const micAriaLabel = computed(() => {
  return isRecordingRequested.value
    ? 'Stop Microphone'
    : 'Start Microphone'
})

const closeWindow = () => {
  if (props.isElectron) {
    ;(window as any).electron.closeApp()
  }
}

const openSettingsWindow = async () => {
  if (window.aliceIPC) {
    try {
      await window.aliceIPC.invoke('settings-window:open')
    } catch (error) {
      console.error('Failed to open settings window:', error)
    }
  }
}

const openApplicationSettings = () => {
  isApplicationMenuOpen.value = false
  if (!isConfigState.value) void openSettingsWindow()
}

const closeApplication = () => {
  isApplicationMenuOpen.value = false
  closeWindow()
}

const changeSidebarView = (view: 'chat' | 'settings') => {
  if (sideBarView.value === view && openSidebar.value) {
    toggleSidebar()
  } else if (sideBarView.value !== view || !openSidebar.value) {
    sideBarView.value = view
    if (!openSidebar.value) {
      if (isMinimized.value) {
        toggleMinimize()
      }
      toggleSidebar()
    }
  }
}

const toggleSidebar = async () => {
  openSidebar.value = !openSidebar.value
  if (props.isElectron) {
    await nextTick()
    const targetWidth = openSidebar.value ? 1200 : 500
    const targetHeight = 500
    ;(window as any).electron.resize({
      width: targetWidth,
      height: targetHeight,
    })
  }
}

const toggleMinimize = async () => {
  if (
    props.isElectron &&
    minimizeBehavior.value === 'taskbar' &&
    !isMinimized.value
  ) {
    window.electron.mini({ minimize: true, behavior: 'taskbar' })
    return
  }

  const willMinimize = !isMinimized.value
  isMinimized.value = willMinimize

  if (props.isElectron) {
    await nextTick()

    if (willMinimize && openSidebar.value) {
      toggleSidebar()
      openSidebar.value = false
      setTimeout(() => {
        console.log('Minimizing window after closing sidebar.')
        window.electron.mini({ minimize: true, behavior: 'corner' })
      }, 300)
    } else {
      console.log(`Toggling minimize state: ${willMinimize}`)
      window.electron.mini({
        minimize: willMinimize,
        behavior: 'corner',
      })
    }
  }
}

const isConfigState = computed(() => {
  return storeAudioState.value === 'CONFIG'
})

const handleMicrophoneClick = () => {
  if (isConfigState.value) {
    console.warn('[Microphone] Cannot start while settings are incomplete.')
    generalStore.statusMessage = 'Complete settings before using the microphone.'
    return
  }
  emit('toggleRecording')
}

onMounted(() => {
  calculateScrollDuration()
  document.addEventListener('pointerdown', closeApplicationMenuOnOutsideClick)
  document.addEventListener('keydown', closeApplicationMenuOnEscape)
})

onUnmounted(() => {
  document.removeEventListener('pointerdown', closeApplicationMenuOnOutsideClick)
  document.removeEventListener('keydown', closeApplicationMenuOnEscape)
})
</script>
