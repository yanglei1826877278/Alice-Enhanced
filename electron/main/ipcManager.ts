import {
  ipcMain,
  desktopCapturer,
  shell,
  clipboard,
  app,
  BrowserWindow,
  dialog,
  type WebContents,
} from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import axios from 'axios'
import { registerCloudVoiceHandlers } from './cloudVoice'
import { loadSettings, saveSettings, AppSettings } from './settingsManager'
import {
  getWebSocketServer,
  restartWebSocketServer,
  stopWebSocketServer,
  startWebSocketServer,
} from './index'

function isBrowserContextToolEnabled(settings: any): boolean {
  return settings?.assistantTools?.includes('browser_context') || false
}

const activeHttpStreams = new Map<string, AbortController>()
let cachedAllowedHttpOrigins: Promise<Set<string>> | null = null

async function getCachedAllowedHttpOrigins(): Promise<Set<string>> {
  if (!cachedAllowedHttpOrigins) {
    cachedAllowedHttpOrigins = loadSettings()
      .then(settings => getAllowedHttpOrigins(settings))
      .catch(error => {
        cachedAllowedHttpOrigins = null
        throw error
      })
  }
  return cachedAllowedHttpOrigins
}

function sendHttpStreamEvent(
  sender: WebContents,
  requestId: string,
  payload: Record<string, any>
): void {
  if (sender.isDestroyed()) {
    return
  }
  sender.send(`http:stream:event:${requestId}`, payload)
}

function readSseDataFrame(frame: string): string | null {
  const data = frame
    .split(/\r?\n/)
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice('data:'.length).trimStart())
    .join('\n')
    .trim()

  return data || null
}
import {
  saveMemoryLocal,
  getRecentMemoriesLocal,
  updateMemoryLocal,
  deleteMemoryLocal,
  deleteAllMemoriesLocal,
} from './memoryManager'
import {
  addThoughtVector,
  searchSimilarThoughts,
  deleteAllThoughtVectors,
  getRecentMessagesForSummarization,
  saveConversationSummary,
  getLatestConversationSummary,
  listConversations,
  getConversation,
  saveConversation,
  renameConversation,
  deleteConversation,
} from './thoughtVectorStore'
import {
  indexPaths as indexRagPaths,
  searchRag,
  clearRag,
  getRagStats,
  removeRagPaths,
} from './ragDocumentStore'
import * as googleAuthManager from './googleAuthManager'
import * as googleCalendarManager from './googleCalendarManager'
import * as googleGmailManager from './googleGmailManager'
import * as schedulerManager from './schedulerManager'
import {
  getMainWindow,
  resizeMainWindow,
  minimizeMainWindow,
  showOverlay,
  hideOverlay,
  focusMainWindow,
  getRendererDist,
  createSettingsWindow,
  closeSettingsWindow,
  setOverlayOpacity,
} from './windowManager'
import {
  registerMicrophoneToggleHotkey,
  registerMutePlaybackHotkey,
  registerTakeScreenshotHotkey,
} from './hotkeyManager'
import { backendManager } from './backendManager'
import type { CustomToolDefinition } from '../../types/customTools'
import {
  loadCustomToolsFromDisk,
  replaceCustomToolsJson,
  uploadCustomToolScript,
  toggleCustomTool,
  deleteCustomTool,
  upsertCustomTool,
  executeCustomTool,
} from './customToolsManager'
import {
  loadCustomAvatarsFromDisk,
  refreshCustomAvatars,
  getCustomAvatarsRootPath,
  setAvatarChatImage,
} from './customAvatarsManager'
import {
  listSkills,
  scanUserSkills,
  activateSkill,
  readSkillResource,
  toggleSkill,
  importSkillFolder,
  removeInstalledSkill,
} from './skillsManager'
import {
  getAllowedHttpOrigins,
  getHttpOriginsRequiringApproval,
  resolvePathWithinRoot,
  validateExternalOpenUrl,
  validateHttpBridgeUrl,
} from './securityBoundaries'
import {
  chooseDataRoot,
  clearLegacyCaches,
  getDataRoot,
  getStorageSnapshot,
  openDataRoot,
  openLogsRoot,
} from './storagePaths'

const GENERATED_IMAGES_DIR_NAME = 'generated_images'
const GENERATED_IMAGES_FULL_PATH = path.join(
  getDataRoot(),
  GENERATED_IMAGES_DIR_NAME
)
const MAX_MEMORY_IMAGE_COUNT = 3
const MAX_MEMORY_IMAGE_URL_LENGTH = 20 * 1024 * 1024

function isSupportedMemoryImageUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > MAX_MEMORY_IMAGE_URL_LENGTH) {
    return false
  }
  if (/^https:\/\/[^\s]+$/i.test(value)) {
    return true
  }
  return /^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=\r\n]+$/i.test(
    value
  )
}

function extractResponseText(data: any): string {
  const chatContent = data?.choices?.[0]?.message?.content
  if (typeof chatContent === 'string') return chatContent.trim()
  if (typeof data?.output_text === 'string') {
    return data.output_text.trim()
  }
  if (!Array.isArray(data?.output)) return ''
  return data.output
    .flatMap((item: any) => (Array.isArray(item?.content) ? item.content : []))
    .filter((item: any) => item?.type === 'output_text')
    .map((item: any) => (typeof item?.text === 'string' ? item.text : ''))
    .join('\n')
    .trim()
}

function normalizeCompatibleBaseUrl(value: string, fallback: string): string {
  const raw = value.trim() || fallback
  const parsed = new URL(raw)
  const isLocalHttp =
    parsed.protocol === 'http:' &&
    ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)
  if (parsed.protocol !== 'https:' && !isLocalHttp) {
    throw new Error(
      'Base URL must use HTTPS (HTTP is allowed only for localhost)'
    )
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('Base URL must not contain credentials, query, or fragment')
  }
  return parsed.toString().replace(/\/$/, '')
}

let screenshotDataURL: string | null = null

let ipcHandlersRegistered = false

function isTrustedLocalOpenPath(targetPath: string): boolean {
  const candidate = path.resolve(targetPath)
  return [GENERATED_IMAGES_FULL_PATH, getCustomAvatarsRootPath()].some(root => {
    const relative = path.relative(path.resolve(root), candidate)
    return (
      relative === '' ||
      (!relative.startsWith('..') && !path.isAbsolute(relative))
    )
  })
}

function broadcastCustomToolsUpdate() {
  BrowserWindow.getAllWindows().forEach(window => {
    if (!window.isDestroyed()) {
      window.webContents.send('custom-tools:updated')
    }
  })
}

export function registerIPCHandlers(): void {
  if (ipcHandlersRegistered) {
    return
  }
  ipcHandlersRegistered = true
  registerCloudVoiceHandlers()

  // Window management
  ipcMain.on('resize', (event, arg) => {
    if (
      arg &&
      typeof arg.width === 'number' &&
      typeof arg.height === 'number'
    ) {
      resizeMainWindow(arg.width, arg.height)
    }
  })

  ipcMain.on('mini', (event, arg) => {
    if (arg && typeof arg.minimize === 'boolean') {
      const behavior = arg.behavior === 'taskbar' ? 'taskbar' : 'corner'
      minimizeMainWindow(arg.minimize, behavior)
    }
  })

  ipcMain.on('close-app', () => {
    app.quit()
  })

  // Embeddings run in the main process so the renderer never makes a
  // cross-origin request to the OpenAI API.
  ipcMain.handle('embedding:generate', async (_event, rawInput: unknown) => {
    const input =
      typeof rawInput === 'string'
        ? rawInput
        : typeof (rawInput as any)?.input === 'string'
          ? (rawInput as any).input
          : ''
    if (!input.trim() || input.length > 20000) {
      return { success: false, error: 'Invalid embedding input' }
    }

    const settings = await loadSettings()
    const isAliyun = settings?.embeddingProvider === 'aliyun'
    const apiKey = isAliyun
      ? settings?.VITE_ALIYUN_API_KEY?.trim()
      : settings?.VITE_OPENAI_API_KEY?.trim()
    if (!apiKey) {
      return {
        success: false,
        error: `${isAliyun ? 'Alibaba Cloud Model Studio' : 'OpenAI'} embedding API key is not configured`,
      }
    }

    try {
      const baseUrl = isAliyun
        ? normalizeCompatibleBaseUrl(settings?.aliyunEmbeddingBaseUrl || '', '')
        : 'https://api.openai.com/v1'
      const model = isAliyun
        ? settings?.aliyunEmbeddingModel?.trim() || 'qwen3.7-text-embedding'
        : 'text-embedding-ada-002'
      const response = await axios.post(
        `${baseUrl}/embeddings`,
        {
          model,
          input,
          ...(isAliyun ? { dimensions: 1024 } : { encoding_format: 'float' }),
        },
        {
          headers: { Authorization: `Bearer ${apiKey}` },
          timeout: 30000,
          maxRedirects: 0,
        }
      )
      const embedding = response.data?.data?.[0]?.embedding
      if (
        !Array.isArray(embedding) ||
        embedding.length !== (isAliyun ? 1024 : 1536) ||
        !embedding.every(
          (value: unknown) =>
            typeof value === 'number' && Number.isFinite(value)
        )
      ) {
        return { success: false, error: 'Invalid OpenAI embedding response' }
      }
      return {
        success: true,
        embedding,
        provider: isAliyun ? 'aliyun' : 'openai',
        model,
      }
    } catch (error) {
      const status = axios.isAxiosError(error)
        ? error.response?.status
        : undefined
      return {
        success: false,
        status,
        error:
          status === 401
            ? `${isAliyun ? 'Alibaba Cloud Model Studio' : 'OpenAI'} embedding API key was rejected (401)`
            : status
              ? `Embedding request failed (${status})`
              : 'Embedding request failed',
      }
    }
  })

  ipcMain.handle('image:describe-for-memory', async (_event, args: unknown) => {
    const payload = args as { imageUrls?: unknown; userText?: unknown }
    const imageUrls = Array.isArray(payload?.imageUrls)
      ? payload.imageUrls
          .filter(isSupportedMemoryImageUrl)
          .slice(0, MAX_MEMORY_IMAGE_COUNT)
      : []
    if (imageUrls.length === 0) {
      return { success: false, error: 'No supported images were provided' }
    }
    if (
      imageUrls.reduce((total, imageUrl) => total + imageUrl.length, 0) >
      MAX_MEMORY_IMAGE_URL_LENGTH
    ) {
      return { success: false, error: 'Image memory payload is too large' }
    }

    const settings = await loadSettings()
    let baseUrl: string
    try {
      baseUrl = normalizeCompatibleBaseUrl(
        settings?.imageMemoryBaseUrl || '',
        'https://api.openai.com/v1'
      )
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
    const usesOpenAIEndpoint =
      new URL(baseUrl).origin === 'https://api.openai.com'
    const apiKey =
      settings?.VITE_IMAGE_MEMORY_API_KEY?.trim() ||
      (usesOpenAIEndpoint ? settings?.VITE_OPENAI_API_KEY?.trim() : '')
    if (!apiKey) {
      return { success: false, error: 'OpenAI API key is not configured' }
    }
    if (settings?.imageMemoryEnabled === false) {
      return { success: false, error: 'Image memory is disabled' }
    }

    const configuredModel = settings?.imageMemoryModel?.trim()
    const model =
      configuredModel && /^[a-zA-Z0-9._:/-]{1,100}$/.test(configuredModel)
        ? configuredModel
        : 'gpt-4o-mini'
    const userText =
      typeof payload?.userText === 'string'
        ? payload.userText.trim().slice(0, 2000)
        : ''
    const prompt = [
      'Create a compact, searchable memory description for the attached image(s).',
      'Mention the main subject, scene, important visual details, application/UI state, and exact error messages or other useful visible text (OCR).',
      'Use the language of the accompanying user text when possible. Return plain text only, no heading or markdown, and stay under 120 words.',
      userText ? `Accompanying user text: ${userText}` : '',
    ]
      .filter(Boolean)
      .join('\n')

    try {
      const response = await axios.post(
        `${baseUrl}/chat/completions`,
        {
          model,
          max_tokens: 220,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                ...imageUrls.map(imageUrl => ({
                  type: 'image_url',
                  image_url: { url: imageUrl, detail: 'low' },
                })),
              ],
            },
          ],
        },
        {
          headers: { Authorization: `Bearer ${apiKey}` },
          timeout: 45000,
          maxRedirects: 0,
          maxBodyLength: 25 * 1024 * 1024,
        }
      )
      const description = extractResponseText(response.data)
      if (!description) {
        return { success: false, error: 'Vision model returned no description' }
      }
      return { success: true, description, model }
    } catch (error) {
      const status = axios.isAxiosError(error)
        ? error.response?.status
        : undefined
      return {
        success: false,
        status,
        error: status
          ? `Image memory description failed (${status})`
          : 'Image memory description failed',
      }
    }
  })

  // Thought vector operations
  ipcMain.handle(
    'thoughtVector:add',
    async (
      event,
      {
        conversationId,
        role,
        textContent,
        embedding,
      }: {
        conversationId: string
        role: string
        textContent: string
        embedding: number[]
      }
    ) => {
      try {
        const provider: 'openai' | 'local' | 'aliyun' =
          embedding.length === 384
            ? 'local'
            : embedding.length === 1024
              ? 'aliyun'
              : 'openai'
        const settings = await loadSettings()

        await addThoughtVector(
          conversationId,
          role,
          textContent,
          embedding,
          provider,
          provider === 'aliyun' ? settings?.aliyunEmbeddingModel : undefined
        )
        return { success: true }
      } catch (error) {
        console.error('IPC thoughtVector:add error:', error)
        return { success: false, error: (error as Error).message }
      }
    }
  )

  ipcMain.handle(
    'thoughtVector:search',
    async (
      event,
      {
        queryEmbedding,
        topK,
        conversationId,
        minSimilarity,
      }: {
        queryEmbedding: number[]
        topK: number
        conversationId?: string
        minSimilarity?: number
      }
    ) => {
      try {
        const provider: 'openai' | 'local' | 'aliyun' | 'both' =
          queryEmbedding.length === 384
            ? 'local'
            : queryEmbedding.length === 1024
              ? 'aliyun'
              : queryEmbedding.length === 1536
                ? 'openai'
                : 'both'

        const settings = await loadSettings()
        const thoughtsMetadatas = await searchSimilarThoughts(
          queryEmbedding,
          topK,
          provider,
          provider === 'aliyun' ? settings?.aliyunEmbeddingModel : undefined,
          conversationId,
          minSimilarity
        )
        const thoughtEntries = thoughtsMetadatas.map(t => ({
          role: t.role,
          textContent: t.textContent,
          score: t.score,
        }))
        return { success: true, data: thoughtEntries }
      } catch (error) {
        console.error('[Main IPC thoughtVector:search] Error:', error)
        return { success: false, error: (error as Error).message }
      }
    }
  )

  ipcMain.handle('thoughtVector:delete-all', async () => {
    try {
      await deleteAllThoughtVectors()
      return { success: true }
    } catch (error) {
      console.error('IPC thoughtVector:delete-all error:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // RAG document operations
  ipcMain.handle('rag:select-paths', async () => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openFile', 'openDirectory', 'multiSelections'],
      })
      if (result.canceled) {
        return { success: true, data: [] }
      }
      return { success: true, data: result.filePaths }
    } catch (error) {
      console.error('[IPC rag:select-paths] Error:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle(
    'rag:index-paths',
    async (event, args: { paths: string[]; recursive?: boolean }) => {
      try {
        const result = await indexRagPaths(args?.paths || [], {
          recursive: args?.recursive ?? true,
        })
        return { success: true, data: result }
      } catch (error) {
        console.error('[IPC rag:index-paths] Error:', error)
        return {
          success: false,
          error:
            error instanceof Error ? error.message : String(error || 'Error'),
        }
      }
    }
  )

  ipcMain.handle(
    'rag:search',
    async (
      event,
      args: { queryEmbedding: number[]; queryText?: string; topK?: number }
    ) => {
      try {
        const results = await searchRag(
          args?.queryEmbedding || [],
          args?.queryText || '',
          args?.topK ?? 5
        )
        return { success: true, data: results }
      } catch (error) {
        console.error('[IPC rag:search] Error:', error)
        return { success: false, error: (error as Error).message }
      }
    }
  )

  ipcMain.handle('rag:clear', async () => {
    try {
      await clearRag()
      return { success: true }
    } catch (error) {
      console.error('[IPC rag:clear] Error:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle(
    'rag:remove-paths',
    async (event, args: { paths: string[] }) => {
      try {
        const result = await removeRagPaths(args?.paths || [])
        return { success: true, data: result }
      } catch (error) {
        console.error('[IPC rag:remove-paths] Error:', error)
        return { success: false, error: (error as Error).message }
      }
    }
  )

  ipcMain.handle('rag:stats', async () => {
    try {
      const stats = await getRagStats()
      return { success: true, data: stats }
    } catch (error) {
      console.error('[IPC rag:stats] Error:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Memory operations
  ipcMain.handle(
    'memory:save',
    async (
      event,
      {
        content,
        memoryType,
        embedding,
        embeddingOpenAI,
        embeddingLocal,
        embeddingAliyun,
      }: {
        content: string
        memoryType?: string
        embedding?: number[]
        embeddingOpenAI?: number[]
        embeddingLocal?: number[]
        embeddingAliyun?: number[]
      }
    ) => {
      try {
        const settings = await loadSettings()
        const savedMemory = await saveMemoryLocal(
          content,
          memoryType,
          embedding,
          embeddingOpenAI,
          embeddingLocal,
          embeddingAliyun,
          settings?.aliyunEmbeddingModel
        )
        return { success: true, data: savedMemory }
      } catch (error) {
        console.error('IPC memory:save error:', error)
        return { success: false, error: (error as Error).message }
      }
    }
  )

  ipcMain.handle(
    'memory:get',
    async (
      event,
      {
        limit,
        memoryType,
        queryEmbedding,
        queryText,
      }: {
        limit?: number
        memoryType?: string
        queryEmbedding?: number[]
        queryText?: string
      }
    ) => {
      try {
        const settings = await loadSettings()
        const memories = await getRecentMemoriesLocal(
          limit,
          memoryType,
          queryEmbedding,
          queryText,
          settings?.aliyunEmbeddingModel
        )
        return { success: true, data: memories }
      } catch (error) {
        console.error('IPC memory:get error:', error)
        return { success: false, error: (error as Error).message }
      }
    }
  )

  ipcMain.handle('memory:delete', async (event, { id }: { id: string }) => {
    try {
      const success = await deleteMemoryLocal(id)
      return { success }
    } catch (error) {
      console.error('IPC memory:delete error:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle(
    'memory:update',
    async (
      event,
      {
        id,
        content,
        memoryType,
        embedding,
        embeddingOpenAI,
        embeddingLocal,
        embeddingAliyun,
        replaceEmbeddings,
      }: {
        id: string
        content: string
        memoryType: string
        embedding?: number[]
        embeddingOpenAI?: number[]
        embeddingLocal?: number[]
        embeddingAliyun?: number[]
        replaceEmbeddings?: boolean
      }
    ) => {
      try {
        const settings = await loadSettings()
        const updatedMemory = await updateMemoryLocal(
          id,
          content,
          memoryType,
          embedding,
          embeddingOpenAI,
          embeddingLocal,
          embeddingAliyun,
          settings?.aliyunEmbeddingModel,
          replaceEmbeddings
        )
        if (updatedMemory) {
          return { success: true, data: updatedMemory }
        } else {
          return { success: false, error: 'Memory not found for update.' }
        }
      } catch (error) {
        console.error('IPC memory:update error:', error)
        return { success: false, error: (error as Error).message }
      }
    }
  )

  ipcMain.handle('memory:delete-all', async () => {
    try {
      await deleteAllMemoriesLocal()
      return { success: true }
    } catch (error) {
      console.error('IPC memory:delete-all error:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Summary operations
  ipcMain.handle(
    'summaries:get-recent-messages',
    async (
      event,
      { limit, conversationId }: { limit: number; conversationId?: string }
    ) => {
      try {
        const messages = await getRecentMessagesForSummarization(
          limit,
          conversationId
        )
        return { success: true, data: messages }
      } catch (error) {
        console.error('IPC summaries:get-recent-messages error:', error)
        return { success: false, error: (error as Error).message }
      }
    }
  )

  ipcMain.handle(
    'summaries:save-summary',
    async (
      event,
      {
        summaryText,
        summarizedMessagesCount,
        conversationId,
      }: {
        summaryText: string
        summarizedMessagesCount: number
        conversationId?: string
      }
    ) => {
      try {
        const summaryRecord = await saveConversationSummary(
          summaryText,
          summarizedMessagesCount,
          conversationId
        )
        return { success: true, data: summaryRecord }
      } catch (error) {
        console.error('IPC summaries:save-summary error:', error)
        return { success: false, error: (error as Error).message }
      }
    }
  )

  ipcMain.handle(
    'summaries:get-latest-summary',
    async (event, { conversationId }: { conversationId?: string }) => {
      try {
        const summary = await getLatestConversationSummary(conversationId)
        return { success: true, data: summary }
      } catch (error) {
        console.error('IPC summaries:get-latest-summary error:', error)
        return { success: false, error: (error as Error).message }
      }
    }
  )

  ipcMain.handle('conversations:list', async () => {
    try {
      return { success: true, data: await listConversations() }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle(
    'conversations:get',
    async (_event, { id }: { id: string }) => {
      try {
        return { success: true, data: await getConversation(id) }
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    }
  )

  ipcMain.handle(
    'conversations:save',
    async (
      _event,
      input: {
        id: string
        title: string
        memoryMode: 'temporary' | 'session' | 'long-term'
        messages: unknown[]
      }
    ) => {
      try {
        return { success: true, data: await saveConversation(input) }
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    }
  )

  ipcMain.handle(
    'conversations:rename',
    async (_event, { id, title }: { id: string; title: string }) => {
      try {
        return { success: await renameConversation(id, title) }
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    }
  )

  ipcMain.handle(
    'conversations:delete',
    async (_event, { id }: { id: string }) => {
      try {
        return { success: await deleteConversation(id) }
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    }
  )

  // System utilities
  ipcMain.handle('get-renderer-dist-path', async () => {
    return getRendererDist()
  })

  ipcMain.handle('screenshot', async (event, arg) => {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: 1200,
        height: 1200,
      },
    })
    if (sources.length > 0) {
      return sources[0].thumbnail.toDataURL()
    }
    return null
  })

  ipcMain.handle('capture-screen', async () => {
    console.log('[Main IPC] "capture-screen" invoked.')
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'] })
      console.log('[Main IPC] "capture-screen" sources found:', sources.length)
      return sources
    } catch (error) {
      console.error('[Main IPC] "capture-screen" error:', error)
      return []
    }
  })

  // Overlay management
  ipcMain.handle('show-overlay', async () => {
    try {
      return await showOverlay()
    } catch (error) {
      console.error('[IPC] Error in show-overlay handler:', error)
      return false
    }
  })

  ipcMain.handle('hide-overlay', () => {
    return hideOverlay()
  })

  ipcMain.handle('set-overlay-opacity', (event, opacity: number) => {
    return setOverlayOpacity(opacity)
  })

  // Screenshot management
  ipcMain.handle('save-screenshot', (event, dataURL: string) => {
    screenshotDataURL = dataURL
    const win = getMainWindow()
    win?.webContents.send('screenshot-captured')
    return true
  })

  ipcMain.handle('get-screenshot', () => {
    return screenshotDataURL
  })

  ipcMain.handle('focus-main-window', () => {
    return focusMainWindow()
  })

  // Settings window management
  ipcMain.handle('settings-window:open', async () => {
    try {
      await createSettingsWindow()
      return { success: true }
    } catch (error: any) {
      console.error('[IPC settings-window:open] Error:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('settings-window:close', () => {
    try {
      closeSettingsWindow()
      return { success: true }
    } catch (error: any) {
      console.error('[IPC settings-window:close] Error:', error)
      return { success: false, error: error.message }
    }
  })

  // Notify main window about settings changes
  ipcMain.handle('settings:notify-main-window', (event, data) => {
    try {
      const mainWindow = getMainWindow()
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('settings-changed', data)
        return { success: true }
      }
      return { success: false, error: 'Main window not available' }
    } catch (error: any) {
      console.error('[IPC settings:notify-main-window] Error:', error)
      return { success: false, error: error.message }
    }
  })

  // App restart
  ipcMain.handle('app:restart', async () => {
    try {
      setImmediate(() => {
        app.relaunch()
        app.quit()
      })
      return { success: true }
    } catch (error: any) {
      console.error('[IPC app:restart] Error:', error)
      return { success: false, error: error.message }
    }
  })

  // Check if app is packaged
  ipcMain.handle('app:is-packaged', () => {
    return app.isPackaged
  })

  ipcMain.handle('storage:get', () => {
    try {
      return { success: true, data: getStorageSnapshot() }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('storage:choose-data-root', async () => {
    try {
      return { success: true, data: await chooseDataRoot() }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('storage:open-data-root', async () => {
    try {
      await openDataRoot()
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('storage:open-logs-root', async () => {
    try {
      await openLogsRoot()
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('storage:clear-legacy-cache', () => {
    try {
      return { success: true, data: clearLegacyCaches() }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // Settings management
  ipcMain.handle('settings:load', async () => {
    const settings = await loadSettings()
    cachedAllowedHttpOrigins = Promise.resolve(getAllowedHttpOrigins(settings))
    return settings
  })

  ipcMain.handle(
    'settings:save',
    async (event, settingsToSave: AppSettings) => {
      try {
        const oldSettings = await loadSettings()
        const originsRequiringApproval = getHttpOriginsRequiringApproval(
          oldSettings,
          settingsToSave
        )

        if (originsRequiringApproval.length > 0) {
          const detail = originsRequiringApproval
            .map(origin => `• ${origin}`)
            .join('\n')
          const options = {
            type: 'warning' as const,
            buttons: ['Cancel', 'Allow'],
            defaultId: 0,
            cancelId: 0,
            noLink: true,
            title: 'Allow network service?',
            message:
              originsRequiringApproval.length === 1
                ? 'Alice wants to connect to a new network service.'
                : 'Alice wants to connect to new network services.',
            detail: `${detail}\n\nOnly allow services that you configured and trust.`,
          }
          const owner = BrowserWindow.fromWebContents(event.sender)
          const confirmation = owner
            ? await dialog.showMessageBox(owner, options)
            : await dialog.showMessageBox(options)

          if (confirmation.response !== 1) {
            return {
              success: false,
              error: 'Network service change was not approved.',
            }
          }
        }

        await saveSettings(settingsToSave)
        void backendManager.reconfigure(settingsToSave).catch(error => {
          console.error(
            '[Main IPC settings:save] Failed to reconfigure local AI components:',
            error
          )
        })
        cachedAllowedHttpOrigins = Promise.resolve(
          getAllowedHttpOrigins(settingsToSave)
        )

        // Handle hotkey changes
        if (
          oldSettings?.microphoneToggleHotkey !==
            settingsToSave.microphoneToggleHotkey ||
          (!oldSettings && settingsToSave.microphoneToggleHotkey)
        ) {
          console.log(
            '[Main IPC settings:save] Microphone toggle hotkey changed. Re-registering.'
          )
          registerMicrophoneToggleHotkey(settingsToSave.microphoneToggleHotkey)
        }

        if (
          oldSettings?.mutePlaybackHotkey !==
            settingsToSave.mutePlaybackHotkey ||
          (!oldSettings && settingsToSave.mutePlaybackHotkey)
        ) {
          console.log(
            '[Main IPC settings:save] Mute playback hotkey changed. Re-registering.'
          )
          registerMutePlaybackHotkey(settingsToSave.mutePlaybackHotkey)
        }

        if (
          oldSettings?.takeScreenshotHotkey !==
            settingsToSave.takeScreenshotHotkey ||
          (!oldSettings && settingsToSave.takeScreenshotHotkey)
        ) {
          console.log(
            '[Main IPC settings:save] Take screenshot hotkey changed. Re-registering.'
          )
          registerTakeScreenshotHotkey(settingsToSave.takeScreenshotHotkey)
        }

        // Handle WebSocket port changes
        if (
          oldSettings?.websocketPort !== settingsToSave.websocketPort ||
          (!oldSettings && settingsToSave.websocketPort)
        ) {
          console.log(
            '[Main IPC settings:save] WebSocket port changed. Restarting WebSocket server.'
          )
          restartWebSocketServer()
        }

        // Handle browser_context tool changes
        const oldBrowserContextEnabled =
          isBrowserContextToolEnabled(oldSettings)
        const newBrowserContextEnabled =
          isBrowserContextToolEnabled(settingsToSave)

        if (oldBrowserContextEnabled !== newBrowserContextEnabled) {
          if (newBrowserContextEnabled) {
            console.log(
              '[Main IPC settings:save] browser_context tool enabled. Starting WebSocket server.'
            )
            startWebSocketServer()
          } else {
            console.log(
              '[Main IPC settings:save] browser_context tool disabled. Stopping WebSocket server.'
            )
            stopWebSocketServer()
          }
        }

        return { success: true }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    }
  )

  // Custom tools management
  ipcMain.handle('custom-tools:list', async () => {
    try {
      const snapshot = await loadCustomToolsFromDisk()
      return { success: true, data: snapshot }
    } catch (error: any) {
      console.error('[IPC custom-tools:list] Error:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle(
    'custom-tools:replace-json',
    async (event, payload: { rawJson: string }) => {
      try {
        const snapshot = await replaceCustomToolsJson(payload?.rawJson || '[]')
        broadcastCustomToolsUpdate()
        return { success: true, data: snapshot }
      } catch (error: any) {
        console.error('[IPC custom-tools:replace-json] Error:', error)
        return { success: false, error: error.message }
      }
    }
  )

  ipcMain.handle(
    'custom-tools:upload-script',
    async (
      event,
      payload: { fileName: string; buffer: ArrayBuffer | Buffer }
    ) => {
      try {
        if (!payload?.fileName || !payload?.buffer) {
          throw new Error('File name and buffer are required.')
        }
        const buffer = Buffer.isBuffer(payload.buffer)
          ? payload.buffer
          : Buffer.from(payload.buffer as ArrayBuffer)
        const result = await uploadCustomToolScript(payload.fileName, buffer)
        return { success: true, data: result }
      } catch (error: any) {
        console.error('[IPC custom-tools:upload-script] Error:', error)
        return { success: false, error: error.message }
      }
    }
  )

  ipcMain.handle(
    'custom-tools:upsert',
    async (event, tool: Partial<CustomToolDefinition>) => {
      try {
        const snapshot = await upsertCustomTool(tool)
        broadcastCustomToolsUpdate()
        return { success: true, data: snapshot }
      } catch (error: any) {
        console.error('[IPC custom-tools:upsert] Error:', error)
        return { success: false, error: error.message }
      }
    }
  )

  ipcMain.handle(
    'custom-tools:toggle',
    async (event, payload: { id: string; enabled: boolean }) => {
      try {
        if (!payload?.id) {
          throw new Error('Tool id is required.')
        }
        const snapshot = await toggleCustomTool(payload.id, !!payload.enabled)
        broadcastCustomToolsUpdate()
        return { success: true, data: snapshot }
      } catch (error: any) {
        console.error('[IPC custom-tools:toggle] Error:', error)
        return { success: false, error: error.message }
      }
    }
  )

  ipcMain.handle(
    'custom-tools:delete',
    async (event, payload: { id: string }) => {
      try {
        if (!payload?.id) {
          throw new Error('Tool id is required.')
        }
        const snapshot = await deleteCustomTool(payload.id)
        broadcastCustomToolsUpdate()
        return { success: true, data: snapshot }
      } catch (error: any) {
        console.error('[IPC custom-tools:delete] Error:', error)
        return { success: false, error: error.message }
      }
    }
  )

  ipcMain.handle(
    'custom-tools:execute',
    async (event, payload: { name: string; args?: Record<string, any> }) => {
      try {
        if (!payload?.name) {
          throw new Error('Tool name is required.')
        }
        const result = await executeCustomTool(payload.name, payload.args || {})
        return { success: true, data: result }
      } catch (error: any) {
        console.error('[IPC custom-tools:execute] Error:', error)
        return { success: false, error: error.message }
      }
    }
  )

  ipcMain.handle('skills:list', async () => {
    try {
      return { success: true, data: await listSkills() }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })
  ipcMain.handle('skills:scan-user', async () => {
    try {
      const data = await scanUserSkills()
      BrowserWindow.getAllWindows().forEach(window =>
        window.webContents.send('skills:updated')
      )
      return { success: true, data }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })
  ipcMain.handle('skills:activate', async (_event, name: string) => {
    try {
      return { success: true, data: await activateSkill(name) }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })
  ipcMain.handle(
    'skills:read-file',
    async (_event, name: string, file: string) => {
      try {
        return { success: true, data: await readSkillResource(name, file) }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    }
  )
  ipcMain.handle(
    'skills:toggle',
    async (_event, name: string, enabled: boolean) => {
      try {
        const data = await toggleSkill(name, enabled)
        BrowserWindow.getAllWindows().forEach(window =>
          window.webContents.send('skills:updated')
        )
        return { success: true, data }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    }
  )
  ipcMain.handle('skills:import-folder', async () => {
    try {
      const data = await importSkillFolder()
      if (data)
        BrowserWindow.getAllWindows().forEach(window =>
          window.webContents.send('skills:updated')
        )
      return { success: true, data }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })
  ipcMain.handle('skills:remove', async (_event, name: string) => {
    try {
      const data = await removeInstalledSkill(name)
      BrowserWindow.getAllWindows().forEach(window =>
        window.webContents.send('skills:updated')
      )
      return { success: true, data }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('custom-avatars:list', async () => {
    try {
      const snapshot = await loadCustomAvatarsFromDisk()
      return { success: true, data: snapshot }
    } catch (error: any) {
      console.error('[IPC custom-avatars:list] Error:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('custom-avatars:refresh', async () => {
    try {
      const snapshot = await refreshCustomAvatars()
      return { success: true, data: snapshot }
    } catch (error: any) {
      console.error('[IPC custom-avatars:refresh] Error:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle(
    'custom-avatars:set-chat-avatar',
    async (_event, payload: { avatarId?: string; imageBytes?: Uint8Array }) => {
      try {
        if (!payload?.avatarId || !payload.imageBytes) {
          throw new Error('Avatar and image data are required.')
        }
        const snapshot = await setAvatarChatImage(
          payload.avatarId,
          new Uint8Array(payload.imageBytes)
        )
        BrowserWindow.getAllWindows().forEach(window =>
          window.webContents.send('custom-avatars:updated')
        )
        return { success: true, data: snapshot }
      } catch (error: any) {
        console.error('[IPC custom-avatars:set-chat-avatar] Error:', error)
        return { success: false, error: error.message }
      }
    }
  )

  // Image management
  ipcMain.handle('image:save-generated', async (event, base64Data: string) => {
    try {
      await mkdir(GENERATED_IMAGES_FULL_PATH, { recursive: true })

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const fileName = `alice_generated_${timestamp}.png`
      const absoluteFilePath = path.join(GENERATED_IMAGES_FULL_PATH, fileName)

      await writeFile(absoluteFilePath, Buffer.from(base64Data, 'base64'))

      console.log(
        '[Main IPC image:save-generated] Image saved to:',
        absoluteFilePath
      )
      return {
        success: true,
        fileName: fileName,
        absolutePathForOpening: absoluteFilePath,
      }
    } catch (error: any) {
      console.error(
        '[Main IPC image:save-generated] RAW ERROR during image save:',
        error
      )
      console.error(
        '[Main IPC image:save-generated] Error message:',
        error.message
      )
      console.error('[Main IPC image:save-generated] Error stack:', error.stack)

      const errorMessage =
        error && typeof error.message === 'string'
          ? error.message
          : 'Unknown error during image save.'
      return {
        success: false,
        error: `Failed to save image in main process: ${errorMessage}`,
      }
    }
  })

  // Save image from base64 for streaming image generation
  ipcMain.handle(
    'save-image-from-base64',
    async (
      event,
      args: {
        base64Data: string
        fileName: string
        isPartial: boolean
      }
    ) => {
      try {
        await mkdir(GENERATED_IMAGES_FULL_PATH, { recursive: true })

        const absoluteFilePath = resolvePathWithinRoot(
          GENERATED_IMAGES_FULL_PATH,
          args.fileName
        )
        const relativeImagePath = args.fileName

        await writeFile(
          absoluteFilePath,
          Buffer.from(args.base64Data, 'base64')
        )

        console.log(
          `[Main IPC save-image-from-base64] ${args.isPartial ? 'Partial' : 'Final'} image saved to:`,
          absoluteFilePath
        )

        return {
          success: true,
          fileName: args.fileName,
          absolutePath: absoluteFilePath,
          relativePath: relativeImagePath,
        }
      } catch (error: any) {
        console.error(
          '[Main IPC save-image-from-base64] Error saving image:',
          error.message
        )
        return {
          success: false,
          error: `Failed to save image: ${error.message}`,
        }
      }
    }
  )

  // System integration
  ipcMain.handle(
    'electron:open-path',
    async (event, args: { target: string }) => {
      if (
        !args ||
        typeof args.target !== 'string' ||
        args.target.trim() === ''
      ) {
        console.error('open_path: Invalid target received:', args)
        return {
          success: false,
          message: 'Error: No valid target path, name, or URL provided.',
        }
      }

      const targetPath = args.target.trim()
      console.log(`Main process received request to open: ${targetPath}`)

      try {
        if (/^(?:https?|mailto):/i.test(targetPath)) {
          const externalUrl = validateExternalOpenUrl(targetPath)
          console.log(`Opening external URL: ${externalUrl}`)
          await shell.openExternal(externalUrl)
          return {
            success: true,
            message: `Successfully initiated opening URL: ${targetPath}`,
          }
        } else {
          if (!isTrustedLocalOpenPath(targetPath)) {
            const owner = BrowserWindow.fromWebContents(event.sender)
            const confirmation = owner
              ? await dialog.showMessageBox(owner, {
                  type: 'warning',
                  buttons: ['Cancel', 'Open'],
                  defaultId: 0,
                  cancelId: 0,
                  noLink: true,
                  title: 'Allow opening a local path?',
                  message: 'Alice wants to open a local path or application.',
                  detail: targetPath,
                })
              : await dialog.showMessageBox({
                  type: 'warning',
                  buttons: ['Cancel', 'Open'],
                  defaultId: 0,
                  cancelId: 0,
                  noLink: true,
                  title: 'Allow opening a local path?',
                  message: 'Alice wants to open a local path or application.',
                  detail: targetPath,
                })

            if (confirmation.response !== 1) {
              return {
                success: false,
                message: 'Opening the local path was denied by the user.',
              }
            }
          }

          console.log(`Opening path/application: ${targetPath}`)
          const errorMessage = await shell.openPath(targetPath)

          if (errorMessage) {
            console.error(
              `Failed to open path "${targetPath}": ${errorMessage}`
            )
            return {
              success: false,
              message: `Error: Could not open "${targetPath}". Reason: ${errorMessage}`,
            }
          } else {
            return {
              success: true,
              message: `Successfully opened path: ${targetPath}`,
            }
          }
        }
      } catch (error: any) {
        console.error(`Unexpected error opening target "${targetPath}":`, error)
        return {
          success: false,
          message: `Error: An unexpected issue occurred while trying to open "${targetPath}". ${error.message || ''}`,
        }
      }
    }
  )

  ipcMain.handle(
    'electron:manage-clipboard',
    async (event, args: { action: 'read' | 'write'; content?: string }) => {
      if (!args || (args.action !== 'read' && args.action !== 'write')) {
        console.error(
          'manage_clipboard: Invalid action received:',
          args?.action
        )
        return {
          success: false,
          message:
            'Error: Invalid action specified. Must be "read" or "write".',
        }
      }

      try {
        if (args.action === 'read') {
          const clipboardText = await clipboard.readText()
          console.log(
            'Clipboard read:',
            clipboardText.substring(0, 100) +
              (clipboardText.length > 100 ? '...' : '')
          )
          return {
            success: true,
            message: 'Successfully read text from clipboard.',
            data: clipboardText,
          }
        } else {
          if (typeof args.content !== 'string') {
            if (args.content === undefined || args.content === null) {
              console.error(
                'manage_clipboard: Content is missing for write action.'
              )
              return {
                success: false,
                message:
                  'Error: Text content must be provided for the "write" action (can be an empty string to clear).',
              }
            }
            console.error(
              'manage_clipboard: Content must be a string for write action.'
            )
            return {
              success: false,
              message:
                'Error: Text content must be a string for the "write" action.',
            }
          }

          clipboard.writeText(args.content)
          console.log('Clipboard write successful.')
          return {
            success: true,
            message: 'Successfully wrote text to clipboard.',
          }
        }
      } catch (error: any) {
        console.error(
          `Unexpected error during clipboard action "${args.action}":`,
          error
        )
        return {
          success: false,
          message: `Error: An unexpected issue occurred during the clipboard operation. ${error.message || ''}`,
        }
      }
    }
  )

  // Go Backend Management
  ipcMain.handle('backend:start', async () => {
    try {
      const success = await backendManager.start(await loadSettings())
      return { success }
    } catch (error: any) {
      console.error('[IPC backend:start] Error:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('backend:stop', async () => {
    try {
      await backendManager.stop()
      return { success: true }
    } catch (error: any) {
      console.error('[IPC backend:stop] Error:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('backend:health', async () => {
    try {
      const isHealthy = await backendManager.isHealthy()
      return { success: true, healthy: isHealthy }
    } catch (error: any) {
      console.error('[IPC backend:health] Error:', error)
      return { success: false, error: error.message, healthy: false }
    }
  })

  ipcMain.handle('backend:service-status', async () => {
    try {
      const serviceStatus = await backendManager.getServiceStatus()
      return { success: true, data: serviceStatus }
    } catch (error: any) {
      console.error('[IPC backend:service-status] Error:', error)
      return { success: false, error: error.message }
    }
  })

  // Backend API URL endpoint - frontend will communicate directly with Go backend
  ipcMain.handle('backend:get-api-url', async () => {
    try {
      const apiUrl = backendManager.getApiUrl()
      return { success: true, data: { apiUrl } }
    } catch (error: any) {
      console.error('[IPC backend:get-api-url] Error:', error)
      return { success: false, error: error.message }
    }
  })

  // HTTP request handler to bypass CORS
  ipcMain.handle(
    'http:request',
    async (
      event,
      args: {
        url: string
        method?: string
        headers?: Record<string, string>
        params?: Record<string, any>
        data?: any
        timeout?: number
      }
    ) => {
      try {
        const {
          url,
          method = 'GET',
          headers = {},
          params,
          data,
          timeout = 15000,
        } = args

        const validatedUrl = validateHttpBridgeUrl(
          url,
          await getCachedAllowedHttpOrigins()
        )

        console.log(
          `[IPC http:request] Making ${method} request to:`,
          validatedUrl
        )

        const response = await axios({
          url: validatedUrl,
          method,
          headers,
          params,
          data,
          timeout,
          maxRedirects: 0,
          validateStatus: () => true, // Don't throw on HTTP error status codes
        })

        return {
          success: true,
          data: response.data,
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        }
      } catch (error: any) {
        console.error('[IPC http:request] Error:', error)
        return {
          success: false,
          error: error.message,
          code: error.code,
          response: error.response
            ? {
                status: error.response.status,
                statusText: error.response.statusText,
                data: error.response.data,
              }
            : null,
        }
      }
    }
  )

  ipcMain.handle(
    'http:stream-start',
    async (
      event,
      args: {
        requestId: string
        url: string
        method?: string
        headers?: Record<string, string>
        params?: Record<string, any>
        data?: any
        timeout?: number
      }
    ) => {
      const {
        requestId,
        url,
        method = 'GET',
        headers = {},
        params,
        data,
        timeout = 120000,
      } = args || {}

      if (!requestId || !url) {
        return {
          success: false,
          error: 'Stream request id and URL are required.',
        }
      }

      let validatedUrl: string
      try {
        validatedUrl = validateHttpBridgeUrl(
          url,
          await getCachedAllowedHttpOrigins()
        )
      } catch (error: any) {
        return {
          success: false,
          error: error.message,
        }
      }

      const abortController = new AbortController()
      activeHttpStreams.set(requestId, abortController)
      const sender = event.sender

      void (async () => {
        let streamDone = false

        const finishStream = () => {
          if (streamDone) {
            return
          }
          streamDone = true
          activeHttpStreams.delete(requestId)
          sendHttpStreamEvent(sender, requestId, { type: 'done' })
        }

        const failStream = (
          error: any,
          status?: number,
          responseData?: any
        ) => {
          activeHttpStreams.delete(requestId)
          sendHttpStreamEvent(sender, requestId, {
            type: 'error',
            error:
              error?.message ||
              responseData?.error?.message ||
              responseData?.message ||
              'HTTP stream request failed.',
            status,
            data: responseData,
          })
        }

        try {
          console.log(
            `[IPC http:stream] Making ${method} request to:`,
            validatedUrl
          )

          const response = await axios({
            url: validatedUrl,
            method,
            headers,
            params,
            data,
            timeout,
            maxRedirects: 0,
            responseType: 'stream',
            signal: abortController.signal,
            validateStatus: () => true,
          })

          if (response.status >= 400) {
            let errorBody = ''
            for await (const chunk of response.data as any) {
              errorBody += Buffer.from(chunk).toString('utf8')
              if (errorBody.length > 65536) {
                break
              }
            }

            let parsedBody: any = errorBody
            try {
              parsedBody = JSON.parse(errorBody)
            } catch {
              // Keep the raw upstream body when it is not JSON.
            }

            failStream(
              new Error(`HTTP stream failed with status ${response.status}.`),
              response.status,
              parsedBody
            )
            return
          }

          sendHttpStreamEvent(sender, requestId, {
            type: 'connected',
            status: response.status,
          })

          let buffer = ''
          for await (const chunk of response.data as any) {
            buffer += Buffer.from(chunk).toString('utf8')

            let separatorIndex = buffer.search(/\r?\n\r?\n/)
            while (separatorIndex !== -1) {
              const frame = buffer.slice(0, separatorIndex)
              const separator = buffer.match(/\r?\n\r?\n/)
              buffer = buffer.slice(
                separatorIndex + (separator?.[0]?.length || 2)
              )

              const dataFrame = readSseDataFrame(frame)
              if (dataFrame === '[DONE]') {
                finishStream()
                return
              }
              if (dataFrame) {
                sendHttpStreamEvent(sender, requestId, {
                  type: 'chunk',
                  data: JSON.parse(dataFrame),
                })
              }

              separatorIndex = buffer.search(/\r?\n\r?\n/)
            }
          }

          const trailingFrame = readSseDataFrame(buffer)
          if (trailingFrame && trailingFrame !== '[DONE]') {
            sendHttpStreamEvent(sender, requestId, {
              type: 'chunk',
              data: JSON.parse(trailingFrame),
            })
          }

          finishStream()
        } catch (error: any) {
          if (abortController.signal.aborted) {
            finishStream()
            return
          }
          console.error('[IPC http:stream] Error:', error)
          failStream(error, error?.response?.status, error?.response?.data)
        }
      })()

      return { success: true }
    }
  )

  ipcMain.handle(
    'http:stream-cancel',
    async (event, args: { requestId: string }) => {
      const abortController = activeHttpStreams.get(args?.requestId)
      if (abortController) {
        abortController.abort()
        activeHttpStreams.delete(args.requestId)
      }
      return { success: true }
    }
  )
}

let googleIPCHandlersRegistered = false

export function registerGoogleIPCHandlers(): void {
  if (googleIPCHandlersRegistered) {
    return
  }
  googleIPCHandlersRegistered = true
  async function withAuthenticatedClient<T>(
    operation: (authClient: any) => Promise<T>,
    serviceName: string
  ): Promise<T | { success: false; error: string; unauthenticated?: boolean }> {
    const authClient = await googleAuthManager.getAuthenticatedClient()
    if (!authClient) {
      return {
        success: false,
        error: `User not authenticated with ${serviceName}. Please authenticate in settings.`,
        unauthenticated: true,
      }
    }
    return operation(authClient)
  }

  // Google Calendar handlers
  ipcMain.handle('google-calendar:list-events', async (event, args) => {
    return withAuthenticatedClient(
      authClient =>
        googleCalendarManager.listEvents(
          authClient,
          args.calendarId,
          args.timeMin,
          args.timeMax,
          args.q,
          args.maxResults
        ),
      'Google Calendar'
    )
  })

  ipcMain.handle('google-calendar:create-event', async (event, args) => {
    return withAuthenticatedClient(
      authClient =>
        googleCalendarManager.createEvent(
          authClient,
          args.calendarId,
          args.eventResource
        ),
      'Google Calendar'
    )
  })

  ipcMain.handle('google-calendar:update-event', async (event, args) => {
    return withAuthenticatedClient(
      authClient =>
        googleCalendarManager.updateEvent(
          authClient,
          args.calendarId,
          args.eventId,
          args.eventResource
        ),
      'Google Calendar'
    )
  })

  ipcMain.handle('google-calendar:delete-event', async (event, args) => {
    return withAuthenticatedClient(
      authClient =>
        googleCalendarManager.deleteEvent(
          authClient,
          args.calendarId,
          args.eventId
        ),
      'Google Calendar'
    )
  })

  // Gmail handlers
  ipcMain.handle('google-gmail:list-messages', async (event, args) => {
    return withAuthenticatedClient(
      authClient =>
        googleGmailManager.listMessages({
          authClient,
          userId: args.userId,
          maxResults: args.maxResults,
          labelIds: args.labelIds,
          q: args.q,
          includeSpamTrash: args.includeSpamTrash,
        }),
      'Gmail'
    )
  })

  ipcMain.handle('google-gmail:get-message', async (event, args) => {
    return withAuthenticatedClient(
      authClient =>
        googleGmailManager.getMessage({
          authClient,
          userId: args.userId,
          id: args.id,
          format: args.format,
        }),
      'Gmail'
    )
  })

  // Scheduler management
  ipcMain.handle('scheduler:create-task', async (event, args) => {
    try {
      const result = await schedulerManager.createScheduledTask(
        args.name,
        args.cronExpression,
        args.actionType,
        args.details,
        {
          scheduleType: args.scheduleType,
          triggerAt: args.triggerAt,
        }
      )
      return result
    } catch (error: any) {
      console.error('[IPC scheduler:create-task] Error:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('scheduler:get-all-tasks', async () => {
    try {
      const tasks = schedulerManager.getAllScheduledTasks()
      return { success: true, tasks }
    } catch (error: any) {
      console.error('[IPC scheduler:get-all-tasks] Error:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle(
    'scheduler:delete-task',
    async (event, { taskId }: { taskId: string }) => {
      try {
        const success = await schedulerManager.deleteScheduledTask(taskId)
        return { success }
      } catch (error: any) {
        console.error('[IPC scheduler:delete-task] Error:', error)
        return { success: false, error: error.message }
      }
    }
  )

  ipcMain.handle(
    'scheduler:toggle-task',
    async (event, { taskId }: { taskId: string }) => {
      try {
        const success = await schedulerManager.toggleTaskStatus(taskId)
        return { success }
      } catch (error: any) {
        console.error('[IPC scheduler:toggle-task] Error:', error)
        return { success: false, error: error.message }
      }
    }
  )

  // WebSocket communication for browser context
  ipcMain.handle('websocket:send-request', async (event, requestData: any) => {
    console.log(
      '[IPC websocket:send-request] Starting request with data:',
      requestData
    )

    try {
      const wss = getWebSocketServer()
      console.log(
        '[IPC websocket:send-request] WebSocket server status:',
        wss ? 'available' : 'null'
      )
      console.log(
        '[IPC websocket:send-request] Connected clients:',
        wss ? wss.clients.size : 0
      )

      if (!wss || wss.clients.size === 0) {
        console.error(
          '[IPC websocket:send-request] No WebSocket clients connected'
        )
        return {
          success: false,
          error:
            'No WebSocket clients connected. Ensure the Chrome extension is running.',
        }
      }

      return new Promise(resolve => {
        let resolved = false
        const timeout = setTimeout(() => {
          if (!resolved) {
            console.error(
              '[IPC websocket:send-request] Request timed out after 10 seconds'
            )
            resolved = true
            resolve({
              success: false,
              error:
                'WebSocket request timed out. Chrome extension may not be responding.',
            })
          }
        }, 10000)

        console.log(
          '[IPC websocket:send-request] Sending request to',
          wss.clients.size,
          'client(s)'
        )

        wss.clients.forEach((client: any) => {
          if (client.readyState === 1) {
            console.log(
              '[IPC websocket:send-request] Sending message to client:',
              requestData
            )
            client.send(JSON.stringify(requestData))

            const onMessage = (data: any) => {
              if (!resolved) {
                try {
                  const response = JSON.parse(data.toString())
                  console.log(
                    '[IPC websocket:send-request] Received message from client:',
                    response
                  )

                  if (
                    response.type === 'context_response' &&
                    response.requestId === requestData.requestId
                  ) {
                    console.log(
                      '[IPC websocket:send-request] Matching response received, resolving promise'
                    )
                    resolved = true
                    clearTimeout(timeout)
                    resolve({ success: true, data: response })
                    client.removeListener('message', onMessage)
                  } else {
                    console.log(
                      '[IPC websocket:send-request] Ignoring non-matching response:',
                      response.type,
                      'expected requestId:',
                      requestData.requestId,
                      'got:',
                      response.requestId
                    )
                  }
                } catch (error) {
                  console.error(
                    '[IPC websocket:send-request] Error parsing message:',
                    error
                  )
                }
              }
            }

            client.on('message', onMessage)
          } else {
            console.log(
              '[IPC websocket:send-request] Client not ready, state:',
              client.readyState
            )
          }
        })

        if (!resolved && wss.clients.size === 0) {
          console.error(
            '[IPC websocket:send-request] No clients to send message to'
          )
          clearTimeout(timeout)
          resolve({
            success: false,
            error: 'No active WebSocket connections',
          })
        }
      })
    } catch (error: any) {
      console.error('[IPC websocket:send-request] Error:', error)
      return {
        success: false,
        error: `WebSocket communication error: ${error.message}`,
      }
    }
  })
}
