<template>
  <div
    class="sidebar-wrapper h-[480px] ml-[380px] flex flex-col absolute z-10"
    :class="{ open: openSidebar, 'is-file-dragging': isFileDragging }"
    @dragenter="handleDragEnter"
    @dragover="handleDragOver"
    @dragleave="handleDragLeave"
    @drop="handleFileDrop"
  >
    <div class="hud-panel-grid" aria-hidden="true"></div>
    <div class="hud-panel-orbit" aria-hidden="true"></div>
    <div class="hud-panel-rail" aria-hidden="true">
      <span>THINK</span>
      <span>CHAT</span>
      <span>CREATE</span>
    </div>
    <div
      v-if="isFileDragging"
      class="attachment-drop-overlay"
      aria-hidden="true"
    >
      <div class="attachment-drop-card">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          stroke-width="1.6"
          stroke="currentColor"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 8.25 12 3.75m0 0-4.5 4.5M12 3.75V15"
          />
        </svg>
        <strong>松开即可添加</strong>
        <span>支持 PNG、JPG、WebP 和 PDF</span>
      </div>
    </div>
    <WindowDragHandle v-if="sideBarView === 'chat'" />
    <header v-if="sideBarView === 'chat'" class="hud-panel-header">
      <div class="hud-identity">
        <strong>AI ASSISTANT</strong>
        <span :title="currentConversationTitle">{{
          currentConversationTitle
        }}</span>
      </div>
      <div class="hud-system-state" :class="{ ready: isConversationReady }">
        <span class="hud-signal-bars" aria-hidden="true">
          <i></i><i></i><i></i><i></i><i></i>
        </span>
        <span>{{ hudStatusText }}</span>
        <span v-if="voiceActivityText" class="text-[9px] text-cyan-200/70">
          · {{ voiceActivityText }}
        </span>
      </div>
      <div class="hud-conversation-count">
        <span class="hud-count-line" aria-hidden="true"></span>
        <strong>CONVERSATION</strong>
        <span>·</span>
        <span>{{ formattedMessageCount }} MESSAGES</span>
        <span
          class="rounded border border-blue-300/25 px-1.5 py-0.5 text-[9px] text-blue-100/70"
        >
          {{ memoryModeLabel(currentMemoryMode) }}
        </span>
        <button
          type="button"
          class="hud-session-trigger window-no-drag"
          :class="{ active: showConversationList }"
          title="会话列表"
          @click="toggleConversationList"
        >
          SESSIONS
        </button>
        <button
          type="button"
          class="hud-session-trigger window-no-drag"
          :class="{ active: showNewConversationMenu }"
          title="新建会话"
          aria-label="新建会话"
          @click="toggleNewConversationMenu"
        >
          ＋ NEW
        </button>
      </div>
    </header>
    <div
      v-if="sideBarView === 'chat' && showNewConversationMenu"
      class="session-popover session-new-popover window-no-drag"
    >
      <p class="session-popover__title">选择新会话类型</p>
      <button
        class="session-option session-option--temporary"
        @click="createConversation('temporary')"
      >
        <strong>临时对话</strong>
        <span>不保存记录，也不调用记忆</span>
      </button>
      <button
        class="session-option session-option--session"
        @click="createConversation('session')"
      >
        <strong>普通会话</strong>
        <span>保存记录，仅使用当前会话上下文</span>
      </button>
      <button
        class="session-option session-option--long-term"
        @click="createConversation('long-term')"
      >
        <strong>长期记忆</strong>
        <span>保存记录，并允许跨会话召回</span>
      </button>
    </div>
    <div
      v-if="sideBarView === 'chat' && showConversationList"
      class="session-popover session-list-popover window-no-drag"
    >
      <div class="session-list-header">
        <strong>会话列表</strong>
        <span>{{ conversations.length }}</span>
      </div>
      <div class="session-list-body">
        <div
          v-for="conversation in conversations"
          :key="conversation.id"
          class="session-list-item"
          :class="{ active: conversation.id === currentConversationId }"
        >
          <button
            type="button"
            class="session-list-item__main"
            @click="selectConversation(conversation.id)"
          >
            <strong>{{ conversation.title }}</strong>
            <span>{{ memoryModeLabel(conversation.memoryMode) }}</span>
          </button>
          <button
            class="session-list-item__action"
            title="重命名"
            @click.stop="renameConversation(conversation)"
          >
            ✎
          </button>
          <button
            class="session-list-item__action session-list-item__action--danger"
            title="删除"
            @click.stop="deleteConversation(conversation)"
          >
            ×
          </button>
        </div>
        <p v-if="conversations.length === 0" class="session-list-empty">
          还没有已保存的会话
        </p>
      </div>
    </div>
    <div
      class="sidebar-content hud-chat-content window-no-drag w-full flex-1 overflow-y-auto flex flex-col relative"
      ref="sidebarContentElement"
      @scroll="handleScroll"
    >
      <Chat
        @processRequest="$emit('processRequest')"
        v-if="sideBarView === 'chat'"
      />
      <MemoryManagerComponent v-if="sideBarView === 'memories'" />

      <div
        v-if="
          sideBarView === 'chat' &&
          !isConversationReady &&
          !settingsStore.isLoading
        "
        class="absolute inset-0 flex items-center justify-center text-center p-4 z-10"
      >
        <div class="text-white">
          <p class="text-lg font-semibold mb-2">
            {{
              generalStore.statusMessage.includes('Error:')
                ? 'Initialization Failed'
                : 'Initializing Alice'
            }}
          </p>
          <p
            v-if="generalStore.statusMessage.includes('Error:')"
            class="text-sm text-red-400"
          >
            {{ generalStore.statusMessage }}
          </p>
          <p v-else class="text-sm">Please wait...</p>

          <button
            v-if="generalStore.statusMessage.includes('Error:')"
            @click="retryInitialization"
            class="mt-4 btn btn-sm btn-warning"
          >
            Retry Init
          </button>
          <button
            v-if="generalStore.statusMessage.includes('Error:')"
            @click="openSettingsWindow"
            class="mt-4 ml-2 btn btn-sm btn-info"
          >
            Check Settings
          </button>
        </div>
      </div>
    </div>

    <div
      class="hud-composer window-no-drag w-full"
      v-if="sideBarView === 'chat'"
    >
      <div
        v-if="pendingUserInput.trim()"
        class="mx-3 mb-2 rounded-lg border border-cyan-400/35 bg-cyan-950/60 p-2.5"
      >
        <div class="mb-2 flex items-center justify-between gap-3 text-xs">
          <span class="text-cyan-200">
            {{
              pendingUserInputState === 'queued'
                ? '已收到，将在当前工具结束后补充给 Alice'
                : '上一轮已经结束，请确认是否发送这段补充'
            }}
          </span>
          <button
            type="button"
            class="text-gray-400 hover:text-white"
            title="删除待处理内容"
            @click="generalStore.clearPendingUserInput()"
          >
            ✕
          </button>
        </div>
        <textarea
          v-model="pendingUserInput"
          class="textarea textarea-sm min-h-14 w-full resize-y bg-black/25 text-sm"
          aria-label="待处理的用户补充"
        ></textarea>
        <div
          v-if="pendingUserInputState === 'review'"
          class="mt-2 flex justify-end"
        >
          <button
            type="button"
            class="btn btn-info btn-xs"
            :disabled="agentProgressPhase !== 'idle'"
            @click="sendPendingUserInput"
          >
            发送补充
          </button>
        </div>
      </div>
      <div v-if="attachedFiles.length" class="pending-attachments">
        <div class="pending-attachments-header">
          <span>已添加 {{ attachedFiles.length }} 个附件</span>
          <span>{{ attachedFiles.length }}/{{ MAX_CHAT_ATTACHMENTS }}</span>
        </div>
        <div class="pending-attachments-list">
          <div
            v-for="attachment in pendingAttachments"
            :key="attachment.key"
            class="pending-attachment"
            :title="attachment.file.name"
          >
            <img
              v-if="attachment.previewUrl"
              :src="attachment.previewUrl"
              :alt="attachment.file.name"
              class="pending-attachment-image"
            />
            <div v-else class="pending-attachment-pdf">PDF</div>
            <span class="pending-attachment-name">{{
              attachment.file.name
            }}</span>
            <button
              type="button"
              @mousedown.stop
              @click.stop.prevent="removeAttachedFile(attachment.index)"
              class="attachment-remove-button window-no-drag"
              :title="`删除 ${attachment.file.name}`"
              :aria-label="`删除 ${attachment.file.name}`"
            >
              ✕
            </button>
          </div>
        </div>
      </div>
      <div class="hud-input-row">
        <button
          type="button"
          class="attachment-button window-no-drag"
          title="添加图片或 PDF"
          aria-label="添加图片或 PDF"
          @click="triggerFileUpload"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            stroke-width="1.8"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="m18.375 12.739-7.693 7.693a4.5 4.5 0 0 1-6.364-6.364l9.546-9.546a3 3 0 0 1 4.243 4.243l-9.553 9.553a1.5 1.5 0 0 1-2.121-2.121l7.095-7.095"
            />
          </svg>
        </button>
        <input
          ref="fileInput"
          type="file"
          multiple
          @change="handleFileSelect"
          class="hidden"
          :accept="CHAT_ATTACHMENT_ACCEPT"
        />
        <div
          class="gradient-border-wrapper hud-editor-shell"
          :class="{ 'opacity-50': !isConversationReady }"
        >
          <input
            ref="chatInputElement"
            v-model="chatInput"
            @keydown.enter="chatInputHandle"
            @paste="handleChatInputPaste"
            @pointerdown.stop="handleChatInputPointer"
            @mousedown.stop
            class="hud-chat-input window-no-drag"
            :placeholder="
              isRecordingRequested
                ? '输入补充信息，将随下一段语音一起发送...'
                : '输入消息...'
            "
            aria-label="输入消息"
          />
        </div>
        <button
          type="button"
          class="hud-send-button window-no-drag"
          title="发送消息"
          aria-label="发送消息"
          :disabled="
            !isConversationReady || (!chatInput.trim() && !attachedFiles.length)
          "
          @click="chatInputHandle()"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="m22 2-7.6 20-3.8-8.6L2 9.6 22 2Z" />
            <path d="M22 2 10.6 13.4" />
          </svg>
        </button>
      </div>
      <div class="hud-composer-meta" aria-hidden="true">
        <span>POWERED BY ALICE</span>
        <span>
          {{
            isRecordingRequested
              ? '文字补充会与下一段语音合并'
              : 'SECURE · RESPONSIVE · DESKTOP'
          }}
        </span>
      </div>
      <div
        class="w-full px-4 pt-1 pb-2 text-center text-xs text-gray-500"
        v-if="!isConversationReady && !attachedFiles.length"
      >
        {{
          generalStore.statusMessage.includes('Error:')
            ? 'AI Services unavailable. Check settings or retry.'
            : 'Initializing AI services...'
        }}
      </div>
    </div>
    <ConversationDialog ref="conversationDialog" />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, nextTick, computed } from 'vue'
import Chat from './Chat.vue'
import WindowDragHandle from './WindowDragHandle.vue'
import ConversationDialog from './ConversationDialog.vue'
import MemoryManagerComponent from './MemoryManager.vue'
import { useGeneralStore } from '../stores/generalStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useConversationStore } from '../stores/conversationStore'
import { storeToRefs } from 'pinia'
import {
  CHAT_ATTACHMENT_ACCEPT,
  MAX_CHAT_ATTACHMENTS,
  getChatAttachmentKind,
  validateChatAttachment,
} from '../utils/chatAttachments'

const generalStore = useGeneralStore()
const settingsStore = useSettingsStore()
const conversationStore = useConversationStore()

const sidebarContentElement = ref<null | HTMLElement>(null)
const emit = defineEmits(['processRequest'])

// Smart scrolling state
const shouldAutoScroll = ref(true)
const scrollThreshold = 100 // pixels from bottom to consider "at bottom"

const {
  openSidebar,
  chatInput,
  sideBarView,
  attachedFiles,
  isRecordingRequested,
  agentProgressPhase,
  audioState,
  pendingUserInput,
  pendingUserInputState,
} = storeToRefs(generalStore)
const { chatHistory } = storeToRefs(generalStore)
const {
  isInitialized: conversationIsInitialized,
  currentConversationId,
  currentConversationTitle,
  currentMemoryMode,
  conversations,
} = storeToRefs(conversationStore)

const isConversationReady = computed(() => conversationIsInitialized.value)
const formattedMessageCount = computed(() =>
  String(
    chatHistory.value.filter(message =>
      ['assistant', 'system', 'developer', 'user'].includes(message.role)
    ).length
  ).padStart(3, '0')
)
const hudStatusText = computed(() => {
  const status = generalStore.statusMessage.toLowerCase()
  if (!isConversationReady.value) {
    return status.includes('error') ? 'SYSTEM ERROR' : 'INITIALIZING'
  }
  if (agentProgressPhase.value !== 'idle') {
    return generalStore.statusMessage.toUpperCase()
  }
  if (status.includes('listening')) return 'LISTENING'
  if (status.includes('speaking')) return 'SPEAKING'
  if (
    status.includes('thinking') ||
    status.includes('processing') ||
    status.includes('creating') ||
    status.includes('uploading') ||
    status.includes('preparing')
  ) {
    return 'PROCESSING'
  }
  return 'SYSTEM READY'
})
const voiceActivityText = computed(() => {
  if (!isRecordingRequested.value) return ''
  if (audioState.value === 'PROCESSING_AUDIO') return '语音识别中'
  if (audioState.value === 'LISTENING') return '麦克风监听中'
  return '麦克风已开启'
})

const showNewConversationMenu = ref(false)
const showConversationList = ref(false)
const isCreatingConversation = ref(false)
const chatInputElement = ref<HTMLInputElement | null>(null)
const conversationDialog = ref<InstanceType<typeof ConversationDialog> | null>(
  null
)

const closeConversationPopovers = () => {
  showNewConversationMenu.value = false
  showConversationList.value = false
}

const focusChatInput = async () => {
  if (
    !chatInputElement.value ||
    sideBarView.value !== 'chat' ||
    !openSidebar.value
  )
    return
  // DOM focus alone cannot restore keyboard input if Electron's webContents
  // lost focus while a native dialog or another window was active.
  if (window.aliceIPC) {
    try {
      await window.aliceIPC.invoke('focus-main-window')
    } catch (error) {
      console.warn('[Sidebar] Could not restore window focus:', error)
    }
  }
  await nextTick()
  const input = chatInputElement.value
  if (!input || sideBarView.value !== 'chat' || !openSidebar.value) return
  input.focus({ preventScroll: true })
}

const handleChatInputPointer = () => {
  if (!document.hasFocus()) void focusChatInput()
}

const handleConversationPopoverOutsidePointer = (event: PointerEvent) => {
  const target = event.target
  if (
    target instanceof Element &&
    target.closest('.session-popover, .hud-session-trigger')
  ) {
    return
  }
  closeConversationPopovers()
}

const handleConversationPopoverKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') closeConversationPopovers()
}

const toggleNewConversationMenu = () => {
  showNewConversationMenu.value = !showNewConversationMenu.value
  showConversationList.value = false
}

const toggleConversationList = () => {
  showConversationList.value = !showConversationList.value
  showNewConversationMenu.value = false
  if (showConversationList.value)
    void conversationStore.refreshConversationList()
}

const createConversation = async (
  memoryMode: 'temporary' | 'session' | 'long-term'
) => {
  if (isCreatingConversation.value) return
  closeConversationPopovers()
  isCreatingConversation.value = true
  try {
    if (chatHistory.value.length > 0) {
      const confirmed = await conversationDialog.value?.open({
        title: '新建会话',
        message: '新建会话后，当前聊天内容会从界面清空。继续吗？',
        confirmLabel: '新建会话',
      })
      if (!confirmed) return
    }
    await conversationStore.startNewConversation(memoryMode)
  } catch (error) {
    console.error('[Sidebar] Failed to create conversation:', error)
    generalStore.statusMessage = `Error: ${
      error instanceof Error ? error.message : 'Failed to create conversation.'
    }`
  } finally {
    isCreatingConversation.value = false
    await focusChatInput()
  }
}

const selectConversation = async (id: string) => {
  closeConversationPopovers()
  try {
    await conversationStore.switchConversation(id)
  } catch (error) {
    console.error('[Sidebar] Failed to switch conversation:', error)
    generalStore.statusMessage = `Error: ${
      error instanceof Error ? error.message : 'Failed to switch conversation.'
    }`
  } finally {
    await focusChatInput()
  }
}

const renameConversation = async (conversation: {
  id: string
  title: string
}) => {
  closeConversationPopovers()
  try {
    const title = await conversationDialog.value?.open({
      title: '重命名会话',
      message: '请输入新的会话名称。',
      confirmLabel: '保存',
      inputValue: conversation.title,
    })
    if (typeof title !== 'string' || !title.trim()) return
    if (conversation.id === currentConversationId.value) {
      await conversationStore.renameCurrentConversation(title)
    } else {
      const result = await window.aliceIPC.invoke('conversations:rename', {
        id: conversation.id,
        title,
      })
      if (result?.success) await conversationStore.refreshConversationList()
    }
  } finally {
    await focusChatInput()
  }
}

const deleteConversation = async (conversation: {
  id: string
  title: string
}) => {
  closeConversationPopovers()
  try {
    const confirmed = await conversationDialog.value?.open({
      title: '删除会话',
      message: `确定删除“${conversation.title}”吗？此操作不可恢复。`,
      confirmLabel: '删除',
      danger: true,
    })
    if (!confirmed) return
    await conversationStore.deleteConversationById(conversation.id)
  } finally {
    await focusChatInput()
  }
}

const memoryModeLabel = (mode: string) => {
  if (mode === 'temporary') return '临时对话'
  if (mode === 'long-term') return '长期记忆'
  return '普通会话'
}
const fileInput = ref<HTMLInputElement | null>(null)
const isFileDragging = ref(false)
const attachmentPreviewUrls = new Map<File, string>()
let fileDragDepth = 0

const fileIdentity = (file: File) =>
  `${file.name}\u0000${file.size}\u0000${file.lastModified}\u0000${file.type}`

const getAttachmentPreviewUrl = (file: File): string | null => {
  if (getChatAttachmentKind(file) !== 'image') return null
  const existing = attachmentPreviewUrls.get(file)
  if (existing) return existing
  const previewUrl = URL.createObjectURL(file)
  attachmentPreviewUrls.set(file, previewUrl)
  return previewUrl
}

const pendingAttachments = computed(() =>
  attachedFiles.value.map((file, index) => ({
    file,
    index,
    key: `${fileIdentity(file)}\u0000${index}`,
    previewUrl: getAttachmentPreviewUrl(file),
  }))
)

const triggerFileUpload = () => {
  if (!isConversationReady.value) return
  fileInput.value?.click()
}

const attachFiles = (files: File[]): boolean => {
  const existingIdentities = new Set(attachedFiles.value.map(fileIdentity))
  const uniqueFiles = files.filter(file => {
    const identity = fileIdentity(file)
    if (existingIdentities.has(identity)) return false
    existingIdentities.add(identity)
    return true
  })

  if (uniqueFiles.length === 0) return true
  if (attachedFiles.value.length + uniqueFiles.length > MAX_CHAT_ATTACHMENTS) {
    generalStore.statusMessage = `Error: You can attach up to ${MAX_CHAT_ATTACHMENTS} files.`
    return false
  }

  for (const file of uniqueFiles) {
    const validationError = validateChatAttachment(file)
    if (validationError) {
      generalStore.statusMessage = `Error: ${file.name}: ${validationError}`
      return false
    }
    if (
      getChatAttachmentKind(file) === 'pdf' &&
      settingsStore.config.aiProvider !== 'openai'
    ) {
      generalStore.statusMessage =
        'Error: PDF chat attachments currently require the OpenAI provider.'
      return false
    }
  }

  attachedFiles.value = [...attachedFiles.value, ...uniqueFiles]
  return true
}

const handleFileSelect = (event: Event) => {
  const target = event.target as HTMLInputElement
  const selectedFiles = Array.from(target.files ?? [])
  if (selectedFiles.length) attachFiles(selectedFiles)
  target.value = ''
}

const handleChatInputPaste = (event: ClipboardEvent) => {
  const clipboard = event.clipboardData
  if (!clipboard) return

  const isImage = (file: File) =>
    file.type.toLowerCase().startsWith('image/') ||
    getChatAttachmentKind(file) === 'image'
  let images = Array.from(clipboard.files).filter(isImage)
  if (images.length === 0) {
    images = Array.from(clipboard.items)
      .filter(item => item.kind === 'file')
      .map(item => item.getAsFile())
      .filter((file): file is File => file !== null && isImage(file))
  }
  if (images.length === 0) return

  // Preserve the browser's normal text insertion for mixed text/image pastes.
  if (!clipboard.getData('text/plain')) event.preventDefault()
  attachFiles(images)
}

const isFileDrag = (event: DragEvent) =>
  Array.from(event.dataTransfer?.types ?? []).includes('Files')

const canAcceptFileDrop = (event: DragEvent) =>
  sideBarView.value === 'chat' && isConversationReady.value && isFileDrag(event)

const handleDragEnter = (event: DragEvent) => {
  if (!canAcceptFileDrop(event)) return
  event.preventDefault()
  fileDragDepth += 1
  isFileDragging.value = true
}

const handleDragOver = (event: DragEvent) => {
  if (!canAcceptFileDrop(event)) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
}

const handleDragLeave = (event: DragEvent) => {
  if (!isFileDrag(event)) return
  fileDragDepth = Math.max(0, fileDragDepth - 1)
  if (fileDragDepth === 0) isFileDragging.value = false
}

const handleFileDrop = (event: DragEvent) => {
  if (!canAcceptFileDrop(event)) return
  event.preventDefault()
  fileDragDepth = 0
  isFileDragging.value = false

  const droppedFiles = Array.from(event.dataTransfer?.files ?? [])
  if (droppedFiles.length === 0) return

  attachFiles(droppedFiles)
}

const removeAttachedFile = (index: number) => {
  attachedFiles.value = attachedFiles.value.filter(
    (_, fileIndex) => fileIndex !== index
  )
}

const clearAttachedFiles = () => {
  attachedFiles.value = []
  if (fileInput.value) {
    fileInput.value.value = ''
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

const changeSidebarView = async (newView: 'chat' | 'memories') => {
  closeConversationPopovers()
  sideBarView.value = newView
  if (newView === 'chat') {
    shouldAutoScroll.value = true // Ensure we scroll when switching to chat
    await nextTick(() => scrollChatToBottom())
  }
}

const chatInputHandle = (event?: KeyboardEvent) => {
  if (event?.isComposing) return
  event?.preventDefault()

  const text = chatInput.value.trim()
  const hasAttachments = attachedFiles.value.length > 0

  if ((text.length > 0 || hasAttachments) && isConversationReady.value) {
    if (agentProgressPhase.value !== 'idle') {
      if (hasAttachments) {
        generalStore.statusMessage =
          '附件和输入内容会保留到当前任务结束后再发送。'
        return
      }
      if (text) {
        generalStore.queuePendingUserInput(text)
        chatInput.value = ''
      }
      return
    }
    chatInput.value = ''
    shouldAutoScroll.value = true
    emit('processRequest', text)
    clearAttachedFiles()
  } else if (!isConversationReady.value) {
    generalStore.statusMessage = 'AI not ready. Please wait or check settings.'
  }
}

const sendPendingUserInput = () => {
  if (agentProgressPhase.value !== 'idle') return
  const text = pendingUserInput.value.trim()
  if (!text) {
    generalStore.clearPendingUserInput()
    return
  }
  generalStore.clearPendingUserInput()
  shouldAutoScroll.value = true
  emit('processRequest', text)
}

watch(
  chatHistory,
  () => {
    if (sideBarView.value === 'chat') {
      smartScrollToBottom()
    }
  },
  { deep: true }
)

const isAtBottom = () => {
  if (!sidebarContentElement.value) return false
  const element = sidebarContentElement.value
  const distanceFromBottom =
    element.scrollHeight - element.scrollTop - element.clientHeight
  return distanceFromBottom <= scrollThreshold
}

const handleScroll = () => {
  shouldAutoScroll.value = isAtBottom()
}

const scrollChatToBottom = () => {
  requestAnimationFrame(() => {
    if (!sidebarContentElement.value) return
    sidebarContentElement.value.scrollTo({
      top: sidebarContentElement.value.scrollHeight,
      behavior: 'smooth',
    })
    shouldAutoScroll.value = true
  })
}

const smartScrollToBottom = () => {
  if (shouldAutoScroll.value) {
    scrollChatToBottom()
  }
}

const retryInitialization = async () => {
  if (!conversationStore.isInitialized) {
    generalStore.statusMessage = 'Retrying init...'
    await conversationStore.initialize()
  }
}

const restoreInteractiveAudioState = () => {
  if (generalStore.isRecordingRequested) {
    generalStore.setAudioState('LISTENING')
  } else {
    generalStore.setAudioState('IDLE')
  }
}

onMounted(async () => {
  document.addEventListener(
    'pointerdown',
    handleConversationPopoverOutsidePointer
  )
  document.addEventListener('keydown', handleConversationPopoverKeydown)

  if (!settingsStore.initialLoadAttempted) {
    await settingsStore.loadSettings()
  }

  const needsSettingsConfig =
    settingsStore.isProduction && !settingsStore.areEssentialSettingsProvided
  const canInitializeAI = settingsStore.areEssentialSettingsProvided
  const aiNeedsInitialization =
    canInitializeAI && !conversationStore.isInitialized

  if (needsSettingsConfig) {
    openSettingsWindow()
    generalStore.setAudioState('CONFIG')
  } else if (aiNeedsInitialization) {
    generalStore.statusMessage = 'Initializing AI...'

    const initSuccess = await conversationStore.initialize()
    if (initSuccess) {
      if (
        generalStore.audioState === 'CONFIG' ||
        generalStore.statusMessage.startsWith('Initializing AI')
      ) {
        restoreInteractiveAudioState()
      }
    } else {
      console.log('[Sidebar] AI initialization failed on mount.')
    }
  } else if (conversationStore.isInitialized) {
    if (generalStore.audioState === 'CONFIG') {
      restoreInteractiveAudioState()
    } else if (
      generalStore.audioState !== 'LISTENING' &&
      generalStore.audioState !== 'SPEAKING' &&
      generalStore.audioState !== 'PROCESSING_AUDIO' &&
      generalStore.audioState !== 'WAITING_FOR_RESPONSE' &&
      !generalStore.isRecordingRequested
    ) {
      generalStore.setAudioState('IDLE')
    }
  } else {
    if (generalStore.audioState === 'CONFIG') generalStore.setAudioState('IDLE')
  }
})

watch(
  attachedFiles,
  currentFiles => {
    const activeFiles = new Set(currentFiles)
    for (const [file, previewUrl] of attachmentPreviewUrls) {
      if (!activeFiles.has(file)) {
        URL.revokeObjectURL(previewUrl)
        attachmentPreviewUrls.delete(file)
      }
    }
  },
  { flush: 'post' }
)

onUnmounted(() => {
  document.removeEventListener(
    'pointerdown',
    handleConversationPopoverOutsidePointer
  )
  document.removeEventListener('keydown', handleConversationPopoverKeydown)
  for (const previewUrl of attachmentPreviewUrls.values()) {
    URL.revokeObjectURL(previewUrl)
  }
  attachmentPreviewUrls.clear()
})

watch(
  () => settingsStore.successMessage,
  async newMessage => {
    if (newMessage) {
      if (
        conversationStore.isInitialized &&
        settingsStore.areEssentialSettingsProvided
      ) {
        settingsStore.successMessage = null

        setTimeout(() => {
          // Keep chat selected when the user opens the panel after settings close.
          changeSidebarView('chat')
          if (window.aliceIPC) {
            window.aliceIPC.invoke('settings-window:close').catch(console.error)
          }
          if (generalStore.audioState === 'CONFIG') {
            restoreInteractiveAudioState()
          }
        }, 1500)
      } else {
        console.warn(
          '[Sidebar] Settings saved (message: "',
          newMessage,
          '"), but AI store initialization failed.'
        )
      }
    }
  }
)
</script>
