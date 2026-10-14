<template>
  <div class="hud-chat-stream">
    <transition-group name="list" tag="div" class="hud-message-list">
      <article
        class="hud-message"
        v-for="(message, index) in chatHistoryDisplay"
        :key="
          message.api_message_id ||
          message.local_id_temp ||
          message.id ||
          `local-${index}`
        "
        :class="{
          'is-assistant': message.role === 'assistant',
          'is-user': message.role === 'user',
          'is-system': message.role === 'system',
          'is-developer': message.role === 'developer',
        }"
      >
        <span
          v-if="message.role !== 'user'"
          class="hud-role-mark"
          aria-hidden="true"
        >
          <img
            v-if="message.role === 'assistant'"
            :src="assistantChatAvatar"
            alt=""
          />
          <svg v-else viewBox="0 0 24 24">
            <path d="m12 2 2.3 7.7L22 12l-7.7 2.3L12 22l-2.3-7.7L2 12l7.7-2.3L12 2Z" />
          </svg>
        </span>
        <div class="hud-message-stack">
          <div class="hud-message-label">
            {{ getMessageLabel(message.role) }}
          </div>
          <div
            class="chat-bubble hud-message-bubble"
            v-html="getDisplayableMessageContent(message)"
            @click="handleChatClick"
          ></div>
          <div v-if="message.role === 'assistant'" class="hud-response-state">
            RESPONSE COMPLETE
          </div>
        </div>
        <div
          v-if="message.role === 'user'"
          class="hud-user-mark"
          aria-hidden="true"
        >
          <img :src="defaultUserChatAvatar" alt="" />
        </div>
      </article>
    </transition-group>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useGeneralStore } from '../stores/generalStore'
import type { ChatMessage, AppChatMessageContentPart } from '../types/chat'
import { messageMarkdown } from '../utils/markdown'
import { storeToRefs } from 'pinia'
import { useCustomAvatarsStore } from '../stores/customAvatarsStore'
import defaultUserChatAvatar from '../assets/images/chat-avatar-user.webp'

const generalStore = useGeneralStore()
const avatars = useCustomAvatarsStore()
const { chatHistory } = storeToRefs(generalStore)
const assistantChatAvatar = computed(
  () => avatars.activeAvatar.chatAvatar || avatars.defaultAssistantChatAvatar
)

const getMessageLabel = (role: ChatMessage['role']) => {
  if (role === 'user') return 'YOU / REQUEST'
  if (role === 'assistant') return 'ALICE / RESPONSE'
  if (role === 'developer') return 'SYSTEM / CONTEXT'
  return 'SYSTEM / EVENT'
}

const chatHistoryDisplay = computed(() => {
  return [...chatHistory.value].reverse().filter(message => {
    const isGenerallyDisplayableRole =
      message.role === 'assistant' ||
      message.role === 'system' ||
      message.role === 'developer' ||
      message.role === 'user'

    if (!isGenerallyDisplayableRole) {
      return false
    }

    if (message.role === 'assistant') {
      if (typeof message.content === 'string') {
        if (message.content.trim() === '') {
          return false
        }
      } else if (Array.isArray(message.content)) {
        if (message.content.length === 0) {
          return false
        }
        const hasDisplayableContent = message.content.some(
          part =>
            (part.type === 'app_text' &&
              part.text &&
              part.text.trim() !== '') ||
            part.type === 'app_generated_image_path' ||
            (part.type === 'app_error' && part.text && part.text.trim() !== '')
        )
        if (!hasDisplayableContent) {
          return false
        }
      } else if (message.content == null) {
        return false
      }
    }

    return true
  })
})

const openImageWithSystemViewer = (absoluteFilePath: string) => {
  if (!absoluteFilePath) {
    console.warn('Cannot open image: No absolute path provided.')
    return
  }
  const correctedPath = absoluteFilePath.replace(/\\/g, '/')
  console.log(
    `Requesting to open image with system viewer at OS path: ${correctedPath}`
  )
  window.aliceIPC
    .invoke('electron:open-path', { target: correctedPath })
    .then(result => {
      if (!result.success) {
        console.error(
          "Failed to open image via IPC ('electron:open-path'):",
          result.message
        )
      }
    })
    .catch(err =>
      console.error("Error invoking 'electron:open-path' for image:", err)
    )
}

const getDisplayableMessageContent = (message: ChatMessage): string => {
  if (typeof message.content === 'string') {
    return messageMarkdown(message.content)
  } else if (Array.isArray(message.content)) {
    let combinedHtml = ''
    for (const [partIndex, part] of (
      message.content as AppChatMessageContentPart[]
    ).entries()) {
      if (part.type === 'app_text' && part.text) {
        if (part.text.trim() !== '') {
          if (part.isScheduledReminder) {
            const timeStr = part.timestamp
              ? new Date(part.timestamp).toLocaleTimeString()
              : ''
            combinedHtml += `
              <div class="scheduled-reminder-container my-2 p-3 bg-gradient-to-r from-orange-500/20 to-yellow-500/20 border-l-4 border-orange-400 rounded-r-lg">
                <div class="flex items-center gap-2 mb-1">
                  <span class="text-lg">⏰</span>
                  <span class="text-sm font-medium text-orange-200">Scheduled Reminder</span>
                  ${timeStr ? `<span class="text-xs text-gray-300 ml-auto">${timeStr}</span>` : ''}
                </div>
                <div class="text-white">${messageMarkdown(part.text)}</div>
                ${part.taskName ? `<div class="text-xs text-gray-300 mt-1 italic">Task: ${part.taskName}</div>` : ''}
              </div>
            `
          } else {
            combinedHtml += messageMarkdown(part.text) + '<br/>'
          }
        }
      } else if (part.type === 'app_file' && part.fileName) {
        combinedHtml += `
          <div class="attached-file my-2 p-2 bg-gray-700/50 rounded-lg flex items-center gap-2 max-w-xs">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6 shrink-0">
              <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
            </svg>
            <span class="font-mono text-sm truncate" title="${part.fileName}">${part.fileName}</span>
          </div>
          <br/>`
      } else if (
        part.type === 'app_generated_image_path' &&
        part.path &&
        part.absolutePathForOpening
      ) {
        const imageSrcForDisplay = `alice-image://${part.path}`
        const imageClass = part.isPartial
          ? 'partial-image-preview'
          : 'final-image'
        const titleText = part.isPartial
          ? `Partial Image Preview ${part.partialIndex || ''} (Click to open if available)`
          : 'Generated Image (Click to open)'

        combinedHtml += `
          <div class="generated-image-container my-2 ${imageClass}">
            <img 
              src="${imageSrcForDisplay}" 
              alt="${titleText}" 
              class="max-w-xs md:max-w-sm rounded-lg cursor-pointer shadow-lg generated-alice-image" 
              data-absolute-path="${part.absolutePathForOpening}"
              title="${titleText}"
            />
            ${part.isPartial ? `<span class="text-xs text-gray-400 block text-center">Generating ...</span>` : ''}
          </div>
          <br/>`
      } else if (part.type === 'app_image_uri' && part.uri) {
        const messageId =
          message.local_id_temp || message.api_message_id || message.id || ''
        combinedHtml += `
          <div class="user-image-attachment">
            <img
              src="${part.uri}"
              alt="User provided image"
              class="user-image-thumbnail"
              title="User provided image"
            />
            <button
              type="button"
              class="remove-chat-image"
              data-message-id="${encodeURIComponent(messageId)}"
              data-part-index="${partIndex}"
              title="删除图片"
              aria-label="删除图片"
            >✕</button>
          </div>
          <br/>`
      } else if (part.type === 'app_error' && part.text) {
        const errorTypeDisplay = part.errorType ? ` (${part.errorType})` : ''
        const errorCodeDisplay = part.errorCode ? ` [${part.errorCode}]` : ''
        const errorParamDisplay = part.errorParam
          ? ` - Parameter: ${part.errorParam}`
          : ''

        combinedHtml += `
          <div class="error-message-container my-3 p-4 bg-gradient-to-r from-red-500/20 to-red-600/20 border-l-4 border-red-500 rounded-r-lg">
            <div class="flex items-start gap-3">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-red-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div class="flex-1">
                <div class="flex items-center gap-2 mb-2">
                  <span class="text-sm font-semibold text-red-300">Error${errorTypeDisplay}</span>
                  ${errorCodeDisplay ? `<span class="text-xs text-gray-400">${errorCodeDisplay}</span>` : ''}
                </div>
                <div class="text-white text-sm leading-relaxed">${part.text}</div>
                ${errorParamDisplay ? `<div class="text-xs text-gray-400 mt-2 italic">${errorParamDisplay}</div>` : ''}
              </div>
            </div>
          </div>
        `
      }
    }

    return combinedHtml.length > 5 && combinedHtml.endsWith('<br/>')
      ? combinedHtml.slice(0, -5)
      : combinedHtml || (message.role === 'assistant' ? '...' : '')
  }
  return messageMarkdown('Error: Unable to display message content.')
}

const handleChatClick = (event: MouseEvent) => {
  let targetElement = event.target as HTMLElement

  const removeImageButton = targetElement.closest(
    '.remove-chat-image'
  ) as HTMLElement | null
  if (removeImageButton) {
    const encodedMessageId = removeImageButton.dataset.messageId
    const partIndex = Number(removeImageButton.dataset.partIndex)
    if (encodedMessageId && Number.isInteger(partIndex)) {
      removeImageFromHistory(decodeURIComponent(encodedMessageId), partIndex)
    }
    event.preventDefault()
    event.stopPropagation()
    return
  }

  // Handle generated image clicks
  if (
    targetElement.tagName === 'IMG' &&
    targetElement.classList.contains('generated-alice-image')
  ) {
    const absoluteImagePath = targetElement.getAttribute('data-absolute-path')
    if (absoluteImagePath) {
      openImageWithSystemViewer(absoluteImagePath)
      event.preventDefault()
      return
    } else {
      console.warn(
        "Clicked generated image has no 'data-absolute-path' attribute."
      )
    }
  }

  // Handle link clicks
  for (
    let i = 0;
    i < 3 && targetElement && targetElement !== event.currentTarget;
    i++
  ) {
    if (targetElement.tagName === 'A') {
      const href = targetElement.getAttribute('href')
      if (
        href &&
        (href.startsWith('http://') ||
          href.startsWith('https://') ||
          href.startsWith('mailto:'))
      ) {
        event.preventDefault()
        window.aliceIPC
          .invoke('electron:open-path', { target: href })
          .then(result => {
            if (!result.success) {
              console.error(
                "Failed to open external link via IPC ('electron:open-path'):",
                result.message
              )
            }
          })
          .catch(err => {
            console.error("Error invoking 'electron:open-path' for link:", err)
          })
        return
      }
    }
    if (targetElement.parentElement) {
      targetElement = targetElement.parentElement
    } else {
      break
    }
  }
}

const removeImageFromHistory = (messageId: string, partIndex: number) => {
  const messageIndex = chatHistory.value.findIndex(
    message =>
      (message.local_id_temp || message.api_message_id || message.id) ===
      messageId
  )
  if (messageIndex === -1) return

  const message = chatHistory.value[messageIndex]
  if (!Array.isArray(message.content)) return
  if (message.content[partIndex]?.type !== 'app_image_uri') return

  const remainingParts = message.content.filter(
    (_, index) => index !== partIndex
  )
  const hasRemainingContent = remainingParts.some(
    part =>
      (part.type === 'app_text' && Boolean(part.text?.trim())) ||
      part.type === 'app_file' ||
      part.type === 'app_generated_image_path' ||
      part.type === 'app_error'
  )

  if (hasRemainingContent) {
    message.content = remainingParts
  } else {
    chatHistory.value.splice(messageIndex, 1)
  }
}
</script>

<style scoped>
.list-enter-active,
.list-leave-active {
  transition: all 0.5s ease;
}
.list-enter-from,
.list-leave-to {
  opacity: 0;
  transform: translateY(30px);
}

.partial-image-preview img {
  border: 2px dashed #00f5cc;
  opacity: 0.8;
}
.final-image img {
  border: 2px solid #5865f2;
}

.chat-bubble {
  word-break: break-word;
  overflow-wrap: break-word;
  max-width: 100%;
}

.chat-bubble * {
  word-break: break-word;
  overflow-wrap: break-word;
  max-width: 100%;
}

.chat-bubble p,
.chat-bubble div,
.chat-bubble span,
.chat-bubble code {
  word-break: break-all;
  overflow-wrap: anywhere;
}

.chat-bubble pre {
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: break-word;
}

:deep(.rag-citation) {
  display: inline-block;
  padding: 0.15rem 0.35rem;
  margin-left: 0.15rem;
  border-radius: 999px;
  font-size: 0.65rem;
  background: rgba(0, 0, 0, 0.15);
  cursor: default;
}
</style>
