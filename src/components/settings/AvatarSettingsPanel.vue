<template>
  <section class="settings-card avatar-settings-card">
    <div class="settings-card-heading">
      <div>
        <span class="settings-eyebrow">YOUR COMPANION</span>
        <h3>角色与取景</h3>
        <p>选一个角色，把画面调整到你喜欢的位置。</p>
      </div>
      <span class="settings-chip">{{ selectedAvatar.name }}</span>
    </div>
    <div class="avatar-editor-layout">
      <div class="avatar-editor-stage">
        <div
          ref="viewport"
          class="avatar-crop-viewport"
          :class="{ 'is-dragging': dragging }"
          tabindex="0"
          role="group"
          aria-label="角色取景预览，可拖动或用方向键移动"
          @pointerdown="startDrag"
          @pointermove="moveDrag"
          @pointerup="endDrag"
          @pointercancel="endDrag"
          @lostpointercapture="dragging = false"
          @keydown="moveWithKeyboard"
        >
          <video
            :key="previewSource"
            :src="previewSource"
            :style="videoStyle"
            autoplay
            muted
            loop
            playsinline
            draggable="false"
            @loadedmetadata="updateAspect"
            @error="handleVideoError"
          />
          <div class="avatar-crop-guides" aria-hidden="true">
            <span></span><span></span>
          </div>
          <span class="avatar-drag-hint">{{
            dragging ? '松开完成调整' : '拖动画面调整位置'
          }}</span>
        </div>
        <div class="avatar-state-tabs" aria-label="预览状态">
          <button
            v-for="state in previewStates"
            :key="state.id"
            type="button"
            :class="{ active: previewState === state.id }"
            @click="previewState = state.id"
          >
            {{ state.label }}
          </button>
        </div>
        <p v-if="videoError" class="settings-inline-error">{{ videoError }}</p>
      </div>
      <div class="avatar-editor-controls">
        <div class="avatar-zoom-label">
          <label for="avatar-zoom">画面缩放</label
          ><span>{{ framing.scale.toFixed(2) }}×</span>
        </div>
        <input
          id="avatar-zoom"
          type="range"
          min="1"
          max="3"
          step="0.01"
          :value="framing.scale"
          class="range range-sm"
          @input="setZoom"
        />
        <p class="settings-help">
          待机、思考和说话分别调整取景。切换上方状态预览，调好后保存即可同步到主窗口。
        </p>
        <button
          type="button"
          class="btn btn-outline btn-sm"
          @click="updateFraming({ x: 0, y: 0, scale: 1 })"
        >
          重置取景
        </button>
        <div class="chat-avatar-editor">
          <img :src="selectedChatAvatar" alt="当前聊天头像" />
          <div class="chat-avatar-editor-copy">
            <h4>聊天头像</h4>
            <p>显示在右侧对话气泡旁，不会改变左侧动态角色。</p>
            <input
              ref="chatAvatarInput"
              type="file"
              class="hidden"
              accept="image/png,image/jpeg,image/webp"
              @change="updateChatAvatar"
            />
            <button
              type="button"
              class="btn btn-outline btn-sm"
              :disabled="avatars.isUpdatingChatAvatar"
              @click="chatAvatarInput?.click()"
            >
              {{ avatars.isUpdatingChatAvatar ? '正在更新…' : '更换聊天头像' }}
            </button>
          </div>
        </div>
        <p v-if="chatAvatarError" class="settings-inline-error">
          {{ chatAvatarError }}
        </p>
        <div class="avatar-import-info">
          <h4>添加你自己的角色</h4>
          <p>在角色目录内新建文件夹，放入三个视频：</p>
          <div class="avatar-file-list">
            <code>standby.mp4</code><code>thinking.mp4</code
            ><code>speaking.mp4</code>
          </div>
          <p class="settings-help">
            只有一个视频也可以复制三份，使用上面的名称。
          </p>
          <code class="avatar-directory">{{ avatars.customizationRoot }}</code>
          <div class="flex flex-wrap gap-2">
            <button type="button" class="btn btn-sm" @click="openFolder">
              打开角色目录</button
            ><button
              type="button"
              class="btn btn-outline btn-sm"
              :disabled="avatars.isRefreshing"
              @click="refreshAvatars"
            >
              {{ avatars.isRefreshing ? '刷新中…' : '刷新角色' }}
            </button>
          </div>
        </div>
      </div>
    </div>
    <div class="avatar-choice-grid">
      <button
        v-for="(avatar, index) in avatars.allAvatars"
        :key="avatar.id"
        type="button"
        class="avatar-choice"
        :class="{ selected: selectedAvatar.id === avatar.id }"
        :aria-pressed="selectedAvatar.id === avatar.id"
        @click="$emit('update:setting', 'assistantAvatar', avatar.id)"
      >
        <span class="avatar-choice-monogram"
          ><img
            :src="avatar.chatAvatar || avatars.defaultAssistantChatAvatar"
            alt="" /></span
        ><span class="avatar-choice-text"
          ><strong>{{ avatar.name }}</strong
          ><small>{{
            avatar.source === 'builtin'
              ? '默认角色'
              : '自定义角色 · ' + String(index).padStart(2, '0')
          }}</small></span
        ><span class="avatar-choice-check" aria-hidden="true">{{
          selectedAvatar.id === avatar.id ? '✓' : ''
        }}</span>
      </button>
    </div>
    <p v-if="avatars.error || directoryError" class="settings-inline-error">
      {{ avatars.error || directoryError }}
    </p>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { AliceSettings } from '../../stores/settingsStore'
import { useCustomAvatarsStore } from '../../stores/customAvatarsStore'
import {
  avatarFrameDimensions,
  avatarFramingStyle,
  getAvatarFraming,
  setAvatarFraming,
  type AvatarFraming,
} from '../../utils/avatarFraming'

const props = defineProps<{ currentSettings: AliceSettings }>()
const emit = defineEmits<{
  'update:setting': [key: keyof AliceSettings, value: string]
}>()
const avatars = useCustomAvatarsStore()
const selectedAvatar = computed(
  () =>
    avatars.allAvatars.find(
      avatar => avatar.id === props.currentSettings.assistantAvatar
    ) || avatars.builtInAvatar
)
const selectedChatAvatar = computed(
  () => selectedAvatar.value.chatAvatar || avatars.defaultAssistantChatAvatar
)
const previewStates = [
  { id: 'standby', label: '待机' },
  { id: 'thinking', label: '思考' },
  { id: 'speaking', label: '说话' },
] as const
const previewState = ref<'standby' | 'thinking' | 'speaking'>('standby')
const previewSource = computed(
  () => selectedAvatar.value.stateVideos[previewState.value]
)
const framing = computed(() =>
  getAvatarFraming(
    props.currentSettings.avatarFraming,
    selectedAvatar.value.id,
    previewState.value
  )
)
const aspect = ref(1)
const videoStyle = computed(() =>
  avatarFramingStyle(framing.value, aspect.value)
)
const viewport = ref<HTMLDivElement>()
const chatAvatarInput = ref<HTMLInputElement>()
const dragging = ref(false)
const videoError = ref('')
const directoryError = ref('')
const chatAvatarError = ref('')
let dragStart = {
  x: 0,
  y: 0,
  frame: { x: 0, y: 0, scale: 1 },
  width: 1,
  height: 1,
}

function updateAspect(event: Event) {
  const video = event.target as HTMLVideoElement
  aspect.value = video.videoWidth / video.videoHeight || 1
  videoError.value = ''
}

function handleVideoError(event: Event) {
  const video = event.target as HTMLVideoElement
  const code = video.error?.code
  const reasons: Record<number, string> = {
    1: '视频加载已中断，请重新选择角色。',
    2: '视频文件读取失败，请检查文件是否存在且可访问。',
    3: '视频解码失败，请检查编码兼容性或文件完整性。',
    4: '视频来源或格式无法加载，请刷新角色列表；若仍失败，请查看日志。',
  }
  videoError.value = code ? reasons[code] || '视频无法播放。' : '视频无法播放。'
  console.warn('[AvatarPreview] Video failed to load:', {
    code,
    message: video.error?.message,
    source: video.currentSrc || video.src,
  })
}

function updateFraming(frame: AvatarFraming) {
  emit(
    'update:setting',
    'avatarFraming',
    setAvatarFraming(
      props.currentSettings.avatarFraming,
      selectedAvatar.value.id,
      frame,
      previewState.value
    )
  )
}
function setZoom(event: Event) {
  updateFraming({
    ...framing.value,
    scale: Number((event.target as HTMLInputElement).value),
  })
}
function startDrag(event: PointerEvent) {
  if (event.button !== 0 || !viewport.value) return
  event.preventDefault()
  const bounds = viewport.value.getBoundingClientRect()
  dragStart = {
    x: event.clientX,
    y: event.clientY,
    frame: { ...framing.value },
    width: bounds.width,
    height: bounds.height,
  }
  dragging.value = true
  viewport.value.setPointerCapture(event.pointerId)
  viewport.value.focus()
}
function moveDrag(event: PointerEvent) {
  if (!dragging.value) return
  const dimensions = avatarFrameDimensions(dragStart.frame, aspect.value)
  const overflowX = ((dimensions.width - 1) * dragStart.width) / 2
  const overflowY = ((dimensions.height - 1) * dragStart.height) / 2
  updateFraming({
    ...dragStart.frame,
    x:
      overflowX > 0
        ? Math.max(
            -1,
            Math.min(
              1,
              dragStart.frame.x + (event.clientX - dragStart.x) / overflowX
            )
          )
        : 0,
    y:
      overflowY > 0
        ? Math.max(
            -1,
            Math.min(
              1,
              dragStart.frame.y + (event.clientY - dragStart.y) / overflowY
            )
          )
        : 0,
  })
}
function endDrag(event: PointerEvent) {
  dragging.value = false
  if (viewport.value?.hasPointerCapture(event.pointerId))
    viewport.value.releasePointerCapture(event.pointerId)
}
function moveWithKeyboard(event: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key))
    return
  event.preventDefault()
  const frame = { ...framing.value }
  const delta = event.shiftKey ? 0.1 : 0.025
  if (event.key === 'ArrowLeft') frame.x -= delta
  if (event.key === 'ArrowRight') frame.x += delta
  if (event.key === 'ArrowUp') frame.y -= delta
  if (event.key === 'ArrowDown') frame.y += delta
  frame.x = Math.max(-1, Math.min(1, frame.x))
  frame.y = Math.max(-1, Math.min(1, frame.y))
  updateFraming(frame)
}
async function refreshAvatars() {
  try {
    await avatars.refresh()
  } catch {}
}
async function updateChatAvatar(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return

  chatAvatarError.value = ''
  try {
    await avatars.setChatAvatar(selectedAvatar.value.id, file)
  } catch (error: any) {
    chatAvatarError.value = error?.message || '聊天头像更新失败。'
  }
}
async function openFolder() {
  directoryError.value = ''
  try {
    const response = await window.aliceIPC.invoke('electron:open-path', {
      target: avatars.customizationRoot,
    })
    if (!response.success)
      throw new Error(response.message || '无法打开角色目录。')
  } catch (error: any) {
    directoryError.value = error.message || '无法打开角色目录。'
  }
}
watch(previewSource, () => {
  aspect.value = 1
  videoError.value = ''
  dragging.value = false
  chatAvatarError.value = ''
})
onMounted(() => avatars.ensureInitialized())
</script>
