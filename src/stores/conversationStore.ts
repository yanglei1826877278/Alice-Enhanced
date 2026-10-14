import { ref, onUnmounted, watch } from 'vue'
import { defineStore, storeToRefs } from 'pinia'
import type OpenAI from 'openai'
import * as api from '../services/apiService'
import { useGeneralStore } from './generalStore'
import type { AudioState } from './generalStore'
import { useSettingsStore, type MemoryMode } from './settingsStore'
import { executeFunction } from '../utils/functionCaller'
import eventBus from '../utils/eventBus'
import { isExpectedAbortError } from '../utils/isAbortError'
import { createStreamHandler } from '../modules/conversation/streamHandler'
import { createToolCallHandler } from '../modules/conversation/toolCallHandler'
import { createApiInputBuilder } from '../modules/conversation/apiInputBuilder'
import { createSummarizer } from '../modules/conversation/summarizer'
import { createSpeechQueueManager } from '../modules/conversation/speechQueue'
import { createTurnManager } from '../modules/conversation/turnManager'
import { createReminderHandler } from '../modules/conversation/reminderHandler'
import { createChatOrchestrator } from '../modules/conversation/chatOrchestrator'
import { createBackendService } from '../modules/conversation/backendService'
import { buildAssistantSystemPrompt } from '../prompts/systemPrompt'
import type { ToolCallHandlerDependencies } from '../modules/conversation/types'
import type { ApiInputBuilderDependencies } from '../modules/conversation/apiInputBuilder'
import type { SummarizerDependencies } from '../modules/conversation/summarizer'
import type { SpeechQueueDependencies } from '../modules/conversation/speechQueue'
import type { TurnManagerDependencies } from '../modules/conversation/turnManager'
import type { ReminderHandlerDependencies } from '../modules/conversation/reminderHandler'
import type { ChatDependencies } from '../modules/conversation/chatOrchestrator'
import { setActiveMemoryMode } from '../services/memoryModeRuntime'

import type { AppChatMessageContentPart, ChatMessage } from '../types/chat'

function parseErrorMessage(error: any): AppChatMessageContentPart {
  let errorMessage = error.message || 'Unknown error occurred'
  let errorType = 'unknown_error'
  let errorCode = null
  let errorParam = null

  if (error.error) {
    const apiError = error.error
    errorMessage = apiError.message || errorMessage
    errorType = apiError.type || errorType
    errorCode = apiError.code
    errorParam = apiError.param
  }

  errorMessage = errorMessage.replace(/^Error:\s*/i, '')

  return {
    type: 'app_error',
    text: errorMessage,
    errorType,
    errorCode,
    errorParam,
    originalError: error,
  }
}

function extractTextFromMessage(message: ChatMessage): string {
  if (typeof message.content === 'string') {
    return message.content
  }
  if (Array.isArray(message.content)) {
    return message.content
      .filter(part => part.type === 'app_text' && part.text)
      .map(part => part.text)
      .join(' ')
  }
  return ''
}

function getMessageIdentity(message: ChatMessage): string {
  return (
    message.local_id_temp ||
    message.api_message_id ||
    message.id ||
    `${message.role}-${message.created_at ?? ''}-${extractTextFromMessage(message).slice(0, 80)}`
  )
}

function formatRagSource(
  pathValue: string,
  title: string,
  page?: number | null
) {
  const fileName = pathValue.split(/[\\/]/).pop() || title
  const pageSuffix = page && page > 0 ? `#p${page}` : ''
  return `${fileName}${pageSuffix}`
}

function buildRagContextBlock(
  results: {
    text: string
    path: string
    title: string
    page?: number | null
    section?: string | null
  }[],
  maxChars: number
): string {
  const prefix = "Relevant excerpts from user's documents (cite when used):"
  let remaining = maxChars - (prefix.length + 1)
  if (remaining <= 0) return ''

  const lines: string[] = []
  for (const result of results) {
    const normalized = result.text.replace(/\s+/g, ' ').trim()
    const snippet =
      normalized.length <= 320 ? normalized : `${normalized.slice(0, 317)}...`
    const source = formatRagSource(result.path, result.title, result.page)
    const section = result.section?.trim()
    const sectionPrefix = section ? `(Section: ${section}) ` : ''
    const entry = `- [${source}] ${sectionPrefix}${snippet}`
    const extra = entry.length + 1
    if (extra > remaining) {
      break
    }
    lines.push(entry)
    remaining -= extra
  }

  if (lines.length === 0) return ''
  return `${prefix}\n${lines.join('\n')}`
}

function buildRagRulesBlock(): string {
  return [
    'RAG_RULES:',
    '- Use the document excerpts below when they are relevant.',
    '- Cite sources inline like [filename#pX].',
    '- If the answer is not in the excerpts, say you could not find it.',
  ].join('\n')
}

function adjustRagConfig(
  prompt: string,
  config: { topK: number; maxContextChars: number }
) {
  const wordCount = prompt.trim().split(/\s+/).filter(Boolean).length
  let topK = config.topK
  let maxContextChars = config.maxContextChars

  if (wordCount <= 6) {
    topK = Math.min(config.topK + 3, 12)
    maxContextChars = Math.min(config.maxContextChars + 800, 5000)
  } else if (wordCount <= 14) {
    topK = Math.min(config.topK + 2, 10)
    maxContextChars = Math.min(config.maxContextChars + 500, 4500)
  } else if (wordCount >= 60) {
    topK = Math.max(config.topK - 3, 2)
    maxContextChars = Math.max(config.maxContextChars - 600, 1200)
  } else if (wordCount >= 30) {
    topK = Math.max(config.topK - 2, 3)
    maxContextChars = Math.max(config.maxContextChars - 400, 1500)
  }

  return { topK, maxContextChars }
}

function rerankRagResults(
  results: {
    text: string
    path: string
    title: string
    score?: number
    page?: number | null
  }[],
  prompt: string
) {
  const normalizeText = (value: string) =>
    value.toLowerCase().replace(/[^a-z0-9]/g, '')
  const stopwords = new Set([
    'what',
    'where',
    'when',
    'which',
    'that',
    'this',
    'with',
    'from',
    'about',
    'your',
    'work',
    'experience',
    'role',
    'position',
    'did',
    'does',
    'done',
    'for',
    'and',
    'the',
  ])
  const keywords = prompt
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(word => word.length >= 4 && !stopwords.has(word))

  if (keywords.length === 0) return results

  const anchorKeywords = keywords.filter(word => word.length >= 5)
  const scored = results.map(result => {
    const haystack =
      `${result.title} ${result.path} ${result.text}`.toLowerCase()
    const normalizedHaystack = normalizeText(haystack)
    const matches = keywords.reduce((count, word) => {
      return haystack.includes(word) ? count + 1 : count
    }, 0)
    return {
      result,
      score: (result.score || 0) + matches * 0.2,
      matches,
      anchorMatches: anchorKeywords.reduce((count, word) => {
        return normalizedHaystack.includes(normalizeText(word))
          ? count + 1
          : count
      }, 0),
    }
  })

  const hasAnchorMatch = scored.some(item => item.anchorMatches > 0)
  const scoped = hasAnchorMatch
    ? scored.filter(item => item.anchorMatches > 0)
    : scored

  scoped.sort((a, b) => {
    if (b.matches !== a.matches) return b.matches - a.matches
    return b.score - a.score
  })

  const ordered = scoped.map(item => item.result)
  const roleScoped =
    /\b(this|that)\s+(role|position)\b/i.test(prompt) ||
    /\bjobscan\b/i.test(prompt)

  if (!roleScoped || ordered.length === 0) return ordered

  const withoutContacts = ordered.filter(result => {
    const text = result.text || ''
    const contactSignals = [
      /@/.test(text),
      /https?:\/\//i.test(text),
      /linkedin/i.test(text),
      /github/i.test(text),
      /\.com/i.test(text),
    ].filter(Boolean).length
    return contactSignals < 2
  })
  const scopedResults = withoutContacts.length > 0 ? withoutContacts : ordered

  const anchorPage = scopedResults[0]?.page
  if (!anchorPage) return ordered

  const samePage = scopedResults.filter(result => result.page === anchorPage)
  return samePage.length > 0 ? samePage : scopedResults
}

function shouldIndexAssistantMessage(message: ChatMessage): boolean {
  if (message.role !== 'assistant') return false
  if (message.tool_calls && message.tool_calls.length > 0) return false
  return Boolean(extractTextFromMessage(message).trim())
}

function createConversationId(): string {
  return `conversation-${globalThis.crypto.randomUUID()}`
}

export interface ConversationListItem {
  id: string
  title: string
  memoryMode: MemoryMode
  createdAt: string
  updatedAt: string
}

export const useConversationStore = defineStore('conversation', () => {
  const generalStore = useGeneralStore()
  const settingsStore = useSettingsStore()
  const {
    setAudioState,
    queueAudioForPlayback,
    updateImageContentPartByGenerationId,
  } = generalStore
  const {
    isRecordingRequested,
    audioState,
    chatHistory,
    audioQueue,
    audioPlayer,
  } = storeToRefs(generalStore)

  const currentResponseId = ref<string | null>(null)
  const currentConversationId = ref<string>(createConversationId())
  const currentConversationTitle = ref('新会话')
  const currentMemoryMode = ref<MemoryMode>('session')
  const conversations = ref<ConversationListItem[]>([])
  const isRestoringConversation = ref(false)
  const currentConversationTurnId = ref<string | null>(null)
  const isInitialized = ref<boolean>(false)
  const availableModels = ref<OpenAI.Models.Model[]>([])
  const isSummarizing = ref<boolean>(false)
  const ttsAbortController = ref<AbortController | null>(null)
  const llmAbortController = ref<AbortController | null>(null)
  const ephemeralEmotionalContext = ref<string | null>(null)
  const getComposedSystemPrompt = () =>
    buildAssistantSystemPrompt(settingsStore.config.assistantSystemPrompt)

  let conversationSaveTimer: ReturnType<typeof setTimeout> | null = null

  const deriveConversationTitle = (): string => {
    if (
      currentConversationTitle.value &&
      currentConversationTitle.value !== '新会话'
    ) {
      return currentConversationTitle.value
    }
    for (let index = chatHistory.value.length - 1; index >= 0; index -= 1) {
      const message = chatHistory.value[index]
      if (message.role !== 'user') continue
      const text = extractTextFromMessage(message).replace(/\s+/g, ' ').trim()
      if (text) return text.slice(0, 36)
    }
    return currentConversationTitle.value || '新会话'
  }

  const refreshConversationList = async () => {
    const result = await window.aliceIPC.invoke('conversations:list')
    if (result?.success && Array.isArray(result.data)) {
      conversations.value = result.data
    }
  }

  const persistCurrentConversation = async () => {
    if (
      isRestoringConversation.value ||
      currentMemoryMode.value === 'temporary'
    ) {
      return
    }
    const title = deriveConversationTitle()
    currentConversationTitle.value = title
    const result = await window.aliceIPC.invoke('conversations:save', {
      id: currentConversationId.value,
      title,
      memoryMode: currentMemoryMode.value,
      messages: JSON.parse(JSON.stringify(chatHistory.value)),
    })
    if (result?.success) await refreshConversationList()
  }

  const scheduleConversationSave = () => {
    if (isRestoringConversation.value) return
    if (conversationSaveTimer) clearTimeout(conversationSaveTimer)
    conversationSaveTimer = setTimeout(() => {
      conversationSaveTimer = null
      void persistCurrentConversation()
    }, 500)
  }

  const switchConversation = async (id: string) => {
    if (id === currentConversationId.value) return
    await persistCurrentConversation()
    const result = await window.aliceIPC.invoke('conversations:get', { id })
    if (!result?.success || !result.data) return

    llmAbortController.value?.abort()
    ttsAbortController.value?.abort()
    speechQueueManager.cancelPending()
    isRestoringConversation.value = true
    try {
      currentConversationId.value = result.data.id
      currentConversationTitle.value = result.data.title || '新会话'
      currentMemoryMode.value = result.data.memoryMode || 'session'
      setActiveMemoryMode(currentMemoryMode.value)
      generalStore.chatHistory = Array.isArray(result.data.messages)
        ? result.data.messages
        : []
      generalStore.attachedFiles = []
      generalStore.clearPendingUserInput()
      generalStore.consumeAgentStopRequest()
      currentResponseId.value = null
      currentConversationTurnId.value = `turn-${Date.now()}`
      ephemeralEmotionalContext.value = null
      generalStore.statusMessage = 'Stand by'
    } finally {
      isRestoringConversation.value = false
    }
  }

  const initializeConversationState = async () => {
    await refreshConversationList()
    const latest = conversations.value[0]
    if (latest) {
      const result = await window.aliceIPC.invoke('conversations:get', {
        id: latest.id,
      })
      if (result?.success && result.data) {
        isRestoringConversation.value = true
        try {
          currentConversationId.value = result.data.id
          currentConversationTitle.value = result.data.title || '新会话'
          currentMemoryMode.value = result.data.memoryMode || 'session'
          setActiveMemoryMode(currentMemoryMode.value)
          generalStore.chatHistory = Array.isArray(result.data.messages)
            ? result.data.messages
            : []
          return
        } finally {
          isRestoringConversation.value = false
        }
      }
    }

    currentConversationId.value = createConversationId()
    currentConversationTitle.value = '新会话'
    currentMemoryMode.value = settingsStore.config.memoryMode
    setActiveMemoryMode(currentMemoryMode.value)
    generalStore.chatHistory = []
    await persistCurrentConversation()
  }

  const chatWithCleanHistory = async () => {
    console.log(
      '[Clean Recovery] Starting fresh conversation without tool-related messages'
    )
    const cleanHistory = chatHistory.value.filter(msg => {
      if (msg.role === 'user') return true

      if (msg.role === 'assistant') {
        if (msg.tool_calls && msg.tool_calls.length > 0) return false

        if (
          !msg.content ||
          (Array.isArray(msg.content) &&
            msg.content.every((c: any) => !c.text || c.text.trim() === ''))
        )
          return false

        return true
      }

      return false
    })

    console.log(
      `[Clean Recovery] Filtered conversation from ${chatHistory.value.length} to ${cleanHistory.length} messages`
    )

    const originalHistory = [...chatHistory.value]
    chatHistory.value = cleanHistory

    try {
      return await chat(false)
    } finally {
      const latestHistory = [...chatHistory.value]
      const originalIdentities = new Set(
        originalHistory.map(getMessageIdentity)
      )
      const additions = latestHistory.filter(
        message => !originalIdentities.has(getMessageIdentity(message))
      )
      chatHistory.value =
        additions.length > 0
          ? [...additions, ...originalHistory]
          : originalHistory
    }
  }

  const initialize = async (): Promise<boolean> => {
    if (isInitialized.value) {
      return true
    }
    if (!settingsStore.initialLoadAttempted) {
      await settingsStore.loadSettings()
    }

    const essentialCheckPassed = settingsStore.areEssentialSettingsProvided
    if (!essentialCheckPassed) {
      generalStore.statusMessage =
        'Error: Core settings (API Keys/Models/STT) not configured.'
      isInitialized.value = false
      return false
    }

    if (availableModels.value.length === 0) {
      await fetchModels()
    }
    isInitialized.value = true
    generalStore.statusMessage = 'Stand by'
    currentResponseId.value = null
    currentConversationTurnId.value = `turn-${Date.now()}`
    await initializeConversationState()

    return true
  }

  const summarizer = createSummarizer(createSummarizerDependencies())

  const triggerConversationSummarization = async () => {
    await summarizer.triggerSummarization()
  }

  const apiInputBuilder = createApiInputBuilder(createApiInputDependencies())

  const buildApiInput = async (
    isNewChain: boolean
  ): Promise<OpenAI.Responses.Request.InputItemLike[]> => {
    return apiInputBuilder.build({ isNewChain })
  }

  function createApiInputDependencies(): ApiInputBuilderDependencies {
    return {
      getChatHistory: () => [...chatHistory.value],
      getMaxHistoryMessagesForApi: () =>
        settingsStore.config.MAX_HISTORY_MESSAGES_FOR_API,
      getAiProvider: () => settingsStore.config.aiProvider,
    }
  }

  function createSummarizerDependencies(): SummarizerDependencies {
    return {
      isSummarizing: () => isSummarizing.value,
      setSummarizing: value => {
        isSummarizing.value = value
      },
      fetchRecentMessages: limit =>
        window.aliceIPC.invoke('summaries:get-recent-messages', {
          limit,
          conversationId: currentConversationId.value,
        }),
      analyzeContext: (formattedMessages, model) =>
        api.createContextAnalysisResponse(formattedMessages, model),
      createSummary: (formattedMessages, model, systemPrompt) =>
        api.createSummarizationResponse(formattedMessages, model, systemPrompt),
      saveSummary: params =>
        window.aliceIPC.invoke('summaries:save-summary', {
          ...params,
          conversationId: currentConversationId.value,
        }),
      setEphemeralEmotionalContext: value => {
        ephemeralEmotionalContext.value = value
      },
      getSummarizationConfig: () => ({
        messageCount: settingsStore.config.SUMMARIZATION_MESSAGE_COUNT,
        model: settingsStore.config.SUMMARIZATION_MODEL,
        systemPrompt: settingsStore.config.SUMMARIZATION_SYSTEM_PROMPT,
      }),
      logError: (...args: any[]) => console.error(...args),
    }
  }

  function createSpeechQueueDependencies(): SpeechQueueDependencies {
    return {
      createAbortController: () => new AbortController(),
      setTtsAbortController: controller => {
        ttsAbortController.value = controller
      },
      ttsStream: (text, signal) => {
        if (!generalStore.isTTSEnabled || signal.aborted) {
          return Promise.resolve(new Response(null, { status: 204 }))
        }
        return api.ttsStream(text, signal)
      },
      queueAudioForPlayback: response => queueAudioForPlayback(response),
      getAudioState: () => audioState.value as AudioState,
      setAudioState: state => setAudioState(state),
      logError: (...args: any[]) => console.error(...args),
    }
  }

  function createReminderHandlerDependencies(): ReminderHandlerDependencies {
    return {
      subscribe: handler => {
        if (!window.aliceIPC) {
          return () => {}
        }
        const listener = (reminderData: any) => {
          handler(reminderData)
        }
        window.aliceIPC.on('scheduler:reminder', listener)
        return () => {
          window.aliceIPC?.off('scheduler:reminder', listener)
        }
      },
      subscribeAgentStatus: handler => {
        if (!window.aliceIPC) return () => {}
        const listener = (statusData: any) => handler(statusData)
        window.aliceIPC.on('agent:status', listener)
        return () => window.aliceIPC?.off('agent:status', listener)
      },
      addMessage: message => generalStore.addMessageToHistory(message),
      enqueueSpeech,
      logInfo: (...args: any[]) => console.log(...args),
      logError: (...args: any[]) => console.error(...args),
    }
  }

  function createChatDependencies(): ChatDependencies {
    return {
      isInitialized: () => isInitialized.value,
      setAudioState: state => setAudioState(state as AudioState),
      getIsRecordingRequested: () => isRecordingRequested.value,
      getCurrentResponseId: () => currentResponseId.value,
      setCurrentResponseId: id => {
        currentResponseId.value = id
      },
      getAiProvider: () => settingsStore.config.aiProvider,
      getAssistantSystemPrompt: () => getComposedSystemPrompt(),
      getEphemeralEmotionalContext: () => ephemeralEmotionalContext.value,
      clearEphemeralEmotionalContext: () => {
        ephemeralEmotionalContext.value = null
      },
      retrieveThoughtsForPrompt: prompt =>
        currentMemoryMode.value === 'temporary'
          ? Promise.resolve([])
          : api.retrieveRelevantThoughtsForPrompt(
              prompt,
              3,
              currentMemoryMode.value === 'session'
                ? currentConversationId.value
                : undefined
            ),
      retrieveDocumentsForPrompt: (prompt, topK) =>
        api.retrieveRelevantDocumentsForPrompt(prompt, topK),
      getRagConfig: () => ({
        enabled: settingsStore.config.ragEnabled,
        topK: settingsStore.config.ragTopK,
        maxContextChars: settingsStore.config.ragMaxContextChars,
      }),
      fetchLatestSummary: () =>
        currentMemoryMode.value === 'temporary'
          ? Promise.resolve({ success: true, data: null })
          : window.aliceIPC.invoke('summaries:get-latest-summary', {
              conversationId: currentConversationId.value,
            }),
      getChatHistory: () => [...chatHistory.value],
      buildApiInput,
      addAssistantPlaceholder: () =>
        generalStore.addMessageToHistory({
          role: 'assistant',
          content: [{ type: 'app_text', text: '' }],
        }),
      processStream,
      createOpenAIResponse: (input, responseId, signal) =>
        api.createOpenAIResponse(
          input,
          responseId,
          true,
          getComposedSystemPrompt(),
          signal
        ),
      createAbortController: () => new AbortController(),
      setLlmAbortController: controller => {
        llmAbortController.value = controller
      },
      handleCleanHistoryRetry: chatWithCleanHistory,
      handleStreamError: (placeholderTempId, error) => {
        const errorContent = parseErrorMessage(error)
        generalStore.updateMessageContentByTempId(placeholderTempId, [
          errorContent,
        ])
      },
      logInfo: (...args: any[]) => console.log(...args),
      logError: (...args: any[]) => console.error(...args),
    }
  }

  function createTurnManagerDependencies(): TurnManagerDependencies {
    return {
      getTtsAbortController: () => ttsAbortController.value,
      setTtsAbortController: controller => {
        ttsAbortController.value = controller
      },
      getLlmAbortController: () => llmAbortController.value,
      setLlmAbortController: controller => {
        llmAbortController.value = controller
      },
      getCurrentResponseId: () => currentResponseId.value,
      getAudioPlayer: () => audioPlayer.value,
      getAudioQueueLength: () => audioQueue.value.length,
      getPendingSpeechCount: () => speechQueueManager.getPendingCount(),
      cancelPendingSpeech: () => speechQueueManager.cancelPending(),
      getAudioState: () => audioState.value,
      setAudioState: state => setAudioState(state),
      isRecordingRequested: () => isRecordingRequested.value,
      triggerSummarization: () => {
        if (currentMemoryMode.value !== 'temporary') {
          triggerConversationSummarization()
        }
      },
      onCancelTts: handler => eventBus.on('cancel-tts', handler),
      offCancelTts: handler => eventBus.off('cancel-tts', handler),
      onCancelLlm: handler => eventBus.on('cancel-llm-stream', handler),
      offCancelLlm: handler => eventBus.off('cancel-llm-stream', handler),
      logInfo: (...args: any[]) => console.log(...args),
      logError: (...args: any[]) => console.error(...args),
    }
  }

  const speechQueueManager = createSpeechQueueManager(
    createSpeechQueueDependencies()
  )

  const enqueueSpeech = async (text: string) => {
    if (!generalStore.isTTSEnabled) return
    await speechQueueManager.enqueueSpeech(text)
  }

  const getPendingSpeechCount = () => speechQueueManager.getPendingCount()

  const toolCallHandler = createToolCallHandler(createToolCallDependencies())

  function createToolCallDependencies(): ToolCallHandlerDependencies {
    return {
      getToolStatusMessage: (toolName, args) =>
        getToolStatusMessage(toolName, args),
      addSystemMessage: messageText => {
        generalStore.addMessageToHistory({
          role: 'system',
          content: [{ type: 'app_text', text: messageText }],
        })
      },
      addUserIntervention: messageText => {
        generalStore.addMessageToHistory({
          role: 'user',
          content: [{ type: 'app_text', text: messageText }],
        })
      },
      consumeQueuedUserInput: () => generalStore.consumeQueuedUserInput(),
      hasQueuedUserInput: () => generalStore.hasQueuedUserInput(),
      isAgentStopRequested: () => generalStore.agentStopRequested,
      consumeAgentStopRequest: () => generalStore.consumeAgentStopRequest(),
      addToolMessage: ({ toolCallId, functionName, content }) => {
        generalStore.addMessageToHistory({
          role: 'tool',
          tool_call_id: toolCallId,
          name: functionName,
          content,
        })
      },
      executeFunction: (functionName, args) =>
        executeFunction(functionName, args, {
          ...settingsStore.config,
          memoryMode: currentMemoryMode.value,
        }),
      buildApiInput,
      createAssistantPlaceholder: () => {
        const placeholder: ChatMessage = {
          role: 'assistant',
          content: [{ type: 'app_text', text: '' }],
        }
        return generalStore.addMessageToHistory(placeholder)
      },
      createAbortController: () => new AbortController(),
      setLlmAbortController: controller => {
        llmAbortController.value = controller
      },
      createOpenAIResponse: (
        input,
        responseId,
        isContinuationAfterTool,
        systemPrompt,
        signal
      ) =>
        api.createOpenAIResponse(
          input,
          responseId,
          isContinuationAfterTool,
          systemPrompt,
          signal
        ),
      processStream,
      parseErrorMessage: error => parseErrorMessage(error),
      updateMessageContent: (placeholderTempId, content) =>
        generalStore.updateMessageContentByTempId(placeholderTempId, content),
      setAudioState: state => setAudioState(state as AudioState),
      isRecordingRequested: () => isRecordingRequested.value,
      getAssistantSystemPrompt: () => getComposedSystemPrompt(),
      getCurrentResponseId: () => currentResponseId.value,
      setCurrentResponseId: responseId => {
        currentResponseId.value = responseId
      },
      logError: (...args: any[]) => console.error(...args),
      logInfo: (...args: any[]) => console.log(...args),
      updateAgentProgress: (phase, detail) =>
        generalStore.updateAgentProgress(phase, detail),
    }
  }

  const turnManager = createTurnManager(createTurnManagerDependencies())
  const reminderHandler = createReminderHandler(
    createReminderHandlerDependencies()
  )
  const backendService = createBackendService(createBackendDependencies())

  onUnmounted(() => {
    if (conversationSaveTimer) clearTimeout(conversationSaveTimer)
    void persistCurrentConversation()
    speechQueueManager.dispose()
    turnManager.dispose()
    reminderHandler.dispose()
  })

  function createStreamDependencies(placeholderTempId: string) {
    return {
      appendAssistantDelta: (delta: string) =>
        generalStore.appendMessageDeltaByTempId(placeholderTempId, delta),
      setAssistantResponseId: (responseId: string) => {
        currentResponseId.value = responseId
        generalStore.updateMessageApiResponseIdByTempId(
          placeholderTempId,
          responseId
        )
      },
      setAssistantMessageId: (messageId: string) => {
        generalStore.updateMessageApiIdByTempId(placeholderTempId, messageId)
      },
      addToolCall: (toolCall: any) =>
        generalStore.addToolCallToMessageByTempId(placeholderTempId, toolCall),
      handleToolCalls: async (toolCalls: OpenAI.Responses.FunctionCall[]) => {
        await toolCallHandler.handleToolCalls({
          toolCalls,
          originalResponseIdForTool: currentResponseId.value,
        })
      },
      handleImagePartial: async (
        generationId: string,
        base64: string,
        partialIndex: number
      ) => {
        try {
          const saveResult = await window.aliceIPC.invoke(
            'save-image-from-base64',
            {
              base64Data: base64,
              fileName: `partial_${generationId}_${partialIndex}_${Date.now()}.png`,
              isPartial: true,
            }
          )

          if (saveResult.success) {
            updateImageContentPartByGenerationId(
              placeholderTempId,
              generationId,
              saveResult.relativePath,
              saveResult.absolutePath,
              true,
              partialIndex
            )
          }
        } catch (error) {
          console.error('Failed to save partial image:', error)
        }
      },
      handleImageFinal: async (generationId: string, base64: string) => {
        try {
          const saveResult = await window.aliceIPC.invoke(
            'save-image-from-base64',
            {
              base64Data: base64,
              fileName: `final_${generationId}_${Date.now()}.png`,
              isPartial: false,
            }
          )

          if (saveResult.success) {
            updateImageContentPartByGenerationId(
              placeholderTempId,
              generationId,
              saveResult.relativePath,
              saveResult.absolutePath,
              false
            )
          }
        } catch (error) {
          console.error('Failed to save final image:', error)
        }
      },
      enqueueSpeech,
      setAudioState: (state: string) => setAudioState(state as AudioState),
      getAudioState: () => audioState.value,
      handleStreamError: (error: unknown) => {
        if (isExpectedAbortError(error)) return
        console.error('Error processing stream:', error)
      },
      updateAgentProgress: (phase?: any, detail?: string) =>
        generalStore.updateAgentProgress(phase, detail),
    }
  }

  async function processStream(
    stream: AsyncIterable<OpenAI.Responses.StreamEvent>,
    placeholderTempId: string,
    isContinuationAfterTool: boolean
  ) {
    const handler = createStreamHandler(
      createStreamDependencies(placeholderTempId)
    )
    let deadlineReached = false
    const deadlineTimer = setTimeout(() => {
      deadlineReached = true
      llmAbortController.value?.abort()
    }, toolCallHandler.getRemainingRunMs())

    const result = await handler
      .process({
        stream,
        options: { isContinuationAfterTool },
      })
      .finally(() => clearTimeout(deadlineTimer))

    if (deadlineReached) {
      generalStore.updateMessageContentByTempId(placeholderTempId, [
        {
          type: 'app_text',
          text: 'I stopped this agent run because it reached the 5 minute time limit.',
        },
      ])
    }

    if (result.streamEndedNormally) {
      const assistantMessage = chatHistory.value.find(
        msg => msg.local_id_temp === placeholderTempId
      )
      if (
        currentMemoryMode.value !== 'temporary' &&
        assistantMessage &&
        shouldIndexAssistantMessage(assistantMessage)
      ) {
        const conversationId = currentConversationId.value
        try {
          await api.indexMessageForThoughts(
            conversationId,
            'assistant',
            assistantMessage
          )
        } catch (error) {
          console.error(
            '[ConversationStore] Error indexing assistant message for thoughts:',
            error
          )
        }
      }
    }

    turnManager.finalizeAfterStream({
      streamEndedNormally: result.streamEndedNormally,
      isContinuationAfterTool,
    })

    return result
  }
  const chatOrchestrator = createChatOrchestrator(createChatDependencies())

  const chat = async (resetAgentRun = true) => {
    if (!toolCallHandler.beginModelTurn(!resetAgentRun)) return
    currentConversationTurnId.value = `turn-${Date.now()}`
    await chatOrchestrator.runChat()
  }

  const startNewConversation = async (
    memoryMode: MemoryMode = settingsStore.config.memoryMode
  ) => {
    await persistCurrentConversation()
    llmAbortController.value?.abort()
    ttsAbortController.value?.abort()
    speechQueueManager.cancelPending()
    generalStore.stopPlaybackAndClearQueue()
    generalStore.finishAgentProgress()
    isRestoringConversation.value = true
    try {
      generalStore.chatInput = ''
      generalStore.chatHistory = []
      generalStore.attachedFiles = []
      generalStore.clearPendingUserInput()
      generalStore.consumeAgentStopRequest()
      currentResponseId.value = null
      currentConversationId.value = createConversationId()
      currentConversationTitle.value = '新会话'
      currentMemoryMode.value = memoryMode
      setActiveMemoryMode(memoryMode)
      currentConversationTurnId.value = `turn-${Date.now()}`
      ephemeralEmotionalContext.value = null
      generalStore.setAudioState(
        generalStore.isRecordingRequested ? 'LISTENING' : 'IDLE'
      )
      generalStore.statusMessage = 'Stand by'
    } finally {
      isRestoringConversation.value = false
    }
    if (memoryMode !== 'temporary') {
      await persistCurrentConversation()
    }
  }

  const renameCurrentConversation = async (title: string) => {
    const normalizedTitle = title.trim().slice(0, 80)
    if (!normalizedTitle) return
    if (currentMemoryMode.value === 'temporary') {
      currentConversationTitle.value = normalizedTitle
      return
    }
    const result = await window.aliceIPC.invoke('conversations:rename', {
      id: currentConversationId.value,
      title: normalizedTitle,
    })
    if (result?.success) {
      currentConversationTitle.value = normalizedTitle
      await refreshConversationList()
    }
  }

  const deleteConversationById = async (id: string) => {
    const wasCurrent = id === currentConversationId.value
    const result = await window.aliceIPC.invoke('conversations:delete', { id })
    if (!result?.success) return false
    await refreshConversationList()
    if (wasCurrent) {
      isRestoringConversation.value = true
      generalStore.chatHistory = []
      currentConversationId.value = createConversationId()
      currentMemoryMode.value = 'temporary'
      setActiveMemoryMode('temporary')
      isRestoringConversation.value = false
      const next = conversations.value[0]
      if (next) await switchConversation(next.id)
      else await startNewConversation(settingsStore.config.memoryMode)
    }
    return true
  }

  watch(chatHistory, scheduleConversationSave, { deep: true })

  const transcribeAudioMessage = async (
    audioArrayBuffer: ArrayBuffer
  ): Promise<string> => {
    return backendService.transcribeAudioMessage(audioArrayBuffer)
  }

  async function fetchModels() {
    const models = await backendService.fetchModels()
    if (models) {
      availableModels.value = models
    }
  }

  function getToolStatusMessage(toolName: string, args?: object): string {
    const messages: Record<string, string | ((args: any) => string)> = {
      get_current_datetime: '🕒 Looking at the clock...',
      open_path: '📂 Opening that for you...',
      manage_clipboard: '📋 Working with your clipboard...',
      search_torrents: '🧲 Looking for torrents...',
      add_torrent_to_qb: '🚀 Starting your download...',
      save_memory: '🧠 Got it, remembering that...',
      recall_memories: '🧠 Let me think back...',
      delete_memory: '🗑️ Forgetting that now...',
      get_calendar_events: '🗓️ Fetching your schedule...',
      create_calendar_event: '🗓️ Adding to your calendar...',
      update_calendar_event: '🗓️ Updating your calendar...',
      delete_calendar_event: '🗑️ Removing from your calendar...',
      get_unread_emails: '📧 Looking for unread emails...',
      search_emails: '📧 Searching emails...',
      get_email_content: '📧 Reading email content...',
      browser_context: '🌐 Looking at your browser...',
      execute_command: (args: any) =>
        `💻 Executing: ${args?.command || 'command'}`,
      list_directory: (args: any) => `📁 Listing: ${args?.path || 'directory'}`,
      schedule_task: (args: any) =>
        `⏰ Scheduling "${args?.name || 'task'}" to run ${args?.schedule || 'periodically'}...`,
      manage_scheduled_tasks: (args: any) => {
        switch (args?.action) {
          case 'list':
            return '📋 Checking your scheduled tasks...'
          case 'delete':
            return '🗑️ Removing scheduled task...'
          case 'toggle':
            return '🔄 Toggling task status...'
          default:
            return '⚙️ Managing scheduled tasks...'
        }
      },
    }

    const message = messages[toolName]
    if (typeof message === 'function') {
      return message(args)
    }
    return message || `⚙️ Using tool: ${toolName}...`
  }

  function getCompletionMessage(functionName: string): string {
    const completionMessages: Record<string, string> = {
      open_path: "✅ Done! I've opened that for you.",
      manage_clipboard: '✅ Clipboard operation completed successfully.',
      execute_command: '✅ Command executed successfully.',
    }

    return (
      completionMessages[functionName] || '✅ Action completed successfully.'
    )
  }

  const chatWithContextAction = async (prompt: string) => {
    if (!isInitialized.value) {
      console.warn('Conversation store not initialized.')
      return
    }
    currentConversationTurnId.value = `turn-${Date.now()}`
    setAudioState('WAITING_FOR_RESPONSE')

    const isNewChain = currentResponseId.value === null
    const constructedApiInput = await buildApiInput(isNewChain)

    const contextMessages: OpenAI.Responses.Request.InputItemLike[] = []

    contextMessages.push({
      role: 'user',
      content: [{ type: 'input_text', text: prompt }],
    })

    const summaryResult = await window.aliceIPC.invoke(
      'summaries:get-latest-summary',
      {}
    )
    if (summaryResult.success && summaryResult.data?.summary_text) {
      const summaryContent = `[CONVERSATION_SUMMARY_START]\nContext from a previous part of our conversation:\n${summaryResult.data.summary_text}\n[CONVERSATION_SUMMARY_END]`
      contextMessages.push({
        role: 'user',
        content: [{ type: 'input_text', text: summaryContent }],
      })
    }

    if (ephemeralEmotionalContext.value) {
      const emotionalContextContent = `[SYSTEM_NOTE: Based on our recent interaction, the user's emotional state seems to be: ${ephemeralEmotionalContext.value}]`
      contextMessages.push({
        role: 'user',
        content: [{ type: 'input_text', text: emotionalContextContent }],
      })
      ephemeralEmotionalContext.value = null
    }

    if (settingsStore.config.ragEnabled) {
      const adjustedConfig = adjustRagConfig(prompt, {
        topK: settingsStore.config.ragTopK,
        maxContextChars: settingsStore.config.ragMaxContextChars,
      })
      const ragResultsRaw = await api.retrieveRelevantDocumentsForPrompt(
        prompt,
        adjustedConfig.topK
      )
      const ragResults = rerankRagResults(ragResultsRaw, prompt)
      if (ragResults.length > 0) {
        contextMessages.push({
          role: 'user',
          content: [{ type: 'input_text', text: buildRagRulesBlock() }],
        })
        const ragBlock = buildRagContextBlock(
          ragResults,
          adjustedConfig.maxContextChars
        )
        if (ragBlock) {
          contextMessages.push({
            role: 'user',
            content: [{ type: 'input_text', text: ragBlock }],
          })
        }
      }
    }

    const finalApiInput = [...contextMessages, ...constructedApiInput]
    const finalInstructions = buildAssistantSystemPrompt(
      settingsStore.config.assistantSystemPrompt
    )

    const assistantMessagePlaceholder: ChatMessage = {
      role: 'assistant',
      content: [{ type: 'app_text', text: '' }],
    }
    const placeholderTempId = generalStore.addMessageToHistory(
      assistantMessagePlaceholder
    )

    try {
      llmAbortController.value = new AbortController()
      const streamResult = await api.createOpenAIResponse(
        finalApiInput,
        currentResponseId.value,
        true,
        finalInstructions,
        llmAbortController.value.signal
      )
      await processStream(streamResult, placeholderTempId, false)
    } catch (error: any) {
      if (!isExpectedAbortError(error)) {
        console.error('Error starting OpenAI response stream:', error)

        if (
          error.message?.includes('Previous response with id') &&
          error.message?.includes('not found')
        ) {
          console.log(
            '[Error Recovery] Previous response ID not found, clearing and retrying'
          )
          currentResponseId.value = null
          return await chatWithContextAction(prompt)
        }

        const errorContent = parseErrorMessage(error)
        generalStore.updateMessageContentByTempId(placeholderTempId, [
          errorContent,
        ])
        setAudioState(isRecordingRequested.value ? 'LISTENING' : 'IDLE')
      }
    }
  }

  function createBackendDependencies() {
    return {
      getConfig: () => settingsStore.config,
      setStatusMessage: (message: string) => {
        generalStore.statusMessage = message
      },
      fetchOpenAIModels: () => api.fetchOpenAIModels(),
      transcribeWithCloudVoice: (audio: ArrayBuffer) =>
        api.transcribeWithCloudVoice(audio),
      transcribeWithOpenAI: (audio: ArrayBuffer) =>
        api.transcribeWithOpenAI(audio),
      transcribeWithGroq: (audio: ArrayBuffer) => api.transcribeWithGroq(audio),
      transcribeWithGoogle: (audio: ArrayBuffer) =>
        api.transcribeWithGoogle(audio),
      transcribeWithBackend: (audio: ArrayBuffer) =>
        api.transcribeWithBackend(audio),
      logInfo: (...args: any[]) => console.log(...args),
      logError: (...args: any[]) => console.error(...args),
    }
  }

  return {
    isInitialized,
    availableModels,
    initialize,
    chat,
    chatWithContextAction,
    transcribeAudioMessage,
    fetchModels,
    currentResponseId,
    currentConversationId,
    currentConversationTitle,
    currentMemoryMode,
    conversations,
    startNewConversation,
    switchConversation,
    renameCurrentConversation,
    deleteConversationById,
    refreshConversationList,
    triggerConversationSummarization,
    getPendingSpeechCount,
  }
})
