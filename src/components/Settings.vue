<template>
  <div class="settings-workspace" data-theme="dark">
    <aside class="settings-sidebar" aria-label="设置导航">
      <div class="settings-sidebar-intro">
        <span class="settings-eyebrow">MAKE IT YOURS</span>
        <h2>你的 Alice</h2>
        <p>一点调整，刚好适合你。</p>
      </div>
      <nav class="settings-navigation">
        <div
          v-for="group in navigationGroups"
          :key="group.label"
          class="settings-nav-group"
        >
          <span class="settings-nav-group-label">{{ group.label }}</span>
          <button
            v-for="item in group.items"
            :key="item.id"
            type="button"
            class="settings-nav-item"
            :class="{ active: activeTab === item.id }"
            :aria-current="activeTab === item.id ? 'page' : undefined"
            @click="activeTab = item.id"
          >
            <SettingsNavIcon :name="item.id" /><span>{{ item.label }}</span
            ><span v-if="activeTab === item.id" class="settings-nav-dot"></span>
          </button>
        </div>
      </nav>
      <div class="settings-sidebar-footer">
        <label class="settings-language-control">
          <span>界面语言</span>
          <select
            :value="locale"
            aria-label="界面语言"
            @change="handleLocaleChange"
          >
            <option value="zh-CN">简体中文</option>
            <option value="en-US">English</option>
          </select>
        </label>
        <div class="settings-local-status">
          <span class="settings-local-dot"></span><span>设置保存在此设备</span
          ><small v-if="appVersion">v{{ appVersion }}</small>
        </div>
      </div>
    </aside>

    <main class="settings-main">
      <header class="settings-page-header">
        <div>
          <span class="settings-eyebrow">ALICE / SETTINGS</span>
          <h1>{{ pageInfo.title }}</h1>
          <p>{{ pageInfo.description }}</p>
        </div>
        <span class="settings-save-indicator" :class="{ dirty: hasChanges }"
          ><i></i>{{ hasChanges ? '有未保存的修改' : '已保存' }}</span
        >
      </header>
      <div ref="settingsScroll" class="settings-scroll-area">
        <div
          v-if="settingsStore.isLoading && !settingsStore.initialLoadAttempted"
          class="settings-empty-state"
        >
          <span class="loading loading-spinner"></span>
          <p>正在读取设置…</p>
        </div>
        <div v-else class="settings-content">
          <CoreSettingsTab
            v-if="
              activeTab === 'core' ||
              activeTab === 'voice' ||
              activeTab === 'knowledge'
            "
            :key="activeTab"
            :section="activeTab"
            :current-settings="currentSettings"
            :available-models="availableModelsForSelect"
            @update:setting="updateCurrentSetting"
          />
          <AssistantSettingsTab
            v-if="activeTab === 'assistant'"
            :current-settings="currentSettings"
            :available-models="availableModelsForSelect"
            :available-tools="availableToolsForSelect"
            :is-refreshing-models="isRefreshingModels"
            :is-tool-configured="isToolConfigured"
            @refresh-models="refreshModels"
            @reset-system-prompt="resetSystemPrompt"
          />
          <UserCustomizationTab
            v-if="activeTab === 'customization' || activeTab === 'tools'"
            :key="activeTab"
            :section="activeTab === 'tools' ? 'tools' : 'appearance'"
            :current-settings="currentSettings"
            @update:setting="updateCurrentSetting"
          />
          <MemoryManager v-if="activeTab === 'memories'" />
          <HotkeysTab
            v-if="activeTab === 'hotkeys'"
            :current-settings="currentSettings"
            :is-recording-hotkey-for="isRecordingHotkeyFor"
            @start-recording-hotkey="startRecordingHotkey"
            @clear-hotkey="clearHotkey"
          />
          <IntegrationsTab
            v-if="activeTab === 'integrations'"
            :current-settings="currentSettings"
            :google-auth-status="googleAuthStatus"
            @connect-google-services="connectGoogleServices"
            @disconnect-google-services="disconnectGoogleServices"
          />
          <SecurityTab v-if="activeTab === 'security'" />
          <StorageSettingsTab v-if="activeTab === 'storage'" />
        </div>
      </div>
      <footer v-if="activeTab !== 'storage'" class="settings-save-bar">
        <div class="settings-save-feedback" role="status" aria-live="polite">
          <span v-if="settingsStore.error" class="settings-inline-error">{{
            settingsStore.error
          }}</span
          ><span v-else-if="saveNotice">{{ saveNotice }}</span
          ><span v-else>{{
            hasChanges
              ? '保存后应用到 Alice，可随时继续调整。'
              : '角色、语音和模型，都由你来决定。'
          }}</span>
        </div>
        <div class="settings-save-actions">
          <button
            v-if="activeTab === 'core' || activeTab === 'assistant'"
            type="button"
            class="btn btn-outline"
            :disabled="settingsStore.isSaving || isCheckingConnection"
            @click="handleCheckConnection"
          >
            {{ isCheckingConnection ? '检测中…' : '检测模型连接' }}</button
          ><button
            type="button"
            class="btn btn-primary"
            :disabled="settingsStore.isSaving || isCheckingConnection"
            @click="handleSaveSettings"
          >
            <span
              v-if="settingsStore.isSaving"
              class="loading loading-spinner loading-xs"
            ></span
            >{{ settingsStore.isSaving ? '保存中…' : '保存设置' }}
          </button>
        </div>
      </footer>
    </main>
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref, watch, onMounted, computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useSettingsStore, type AliceSettings } from '../stores/settingsStore'
import { useConversationStore } from '../stores/conversationStore'
import { reinitializeClients } from '../services/apiClients'
import SettingsNavIcon from './settings/SettingsNavIcon.vue'
import {
  CORE_ASSISTANT_TOOL_NAME_SET,
  PREDEFINED_OPENAI_TOOLS,
} from '../utils/assistantTools'
import { DEFAULT_ASSISTANT_PERSONA_PROMPT } from '../stores/settingsStore'
import { useHotkeyRecording } from '../composables/useHotkeyRecording'
import { useGoogleAuth } from '../composables/useGoogleAuth'
import {
  getStaticModelsForProvider,
  PROVIDER_CONFIGS,
  type ProviderModelDefinition,
} from '../services/llmProviders/providerCatalog'
import CoreSettingsTab from './settings/CoreSettingsTab.vue'
import AssistantSettingsTab from './settings/AssistantSettingsTab.vue'
import HotkeysTab from './settings/HotkeysTab.vue'
import IntegrationsTab from './settings/IntegrationsTab.vue'
import SecurityTab from './settings/SecurityTab.vue'
import StorageSettingsTab from './settings/StorageSettingsTab.vue'
import UserCustomizationTab from './settings/UserCustomizationTab.vue'
import MemoryManager from './MemoryManager.vue'
import { useI18n, type UiLocale } from '../i18n'

const appVersion = ref(import.meta.env.VITE_APP_VERSION || '')
const settingsStore = useSettingsStore()
const conversationStore = useConversationStore()
const { settings } = storeToRefs(settingsStore)
const { locale, setLocale, t } = useI18n()

const handleLocaleChange = (event: Event) => {
  setLocale((event.target as HTMLSelectElement).value as UiLocale)
}

const currentSettings = ref<AliceSettings>({
  ...JSON.parse(JSON.stringify(settings.value)),
})
const activeTab = ref<
  | 'core'
  | 'voice'
  | 'knowledge'
  | 'tools'
  | 'assistant'
  | 'hotkeys'
  | 'integrations'
  | 'security'
  | 'storage'
  | 'memories'
  | 'customization'
>('core')

type SettingsTab = typeof activeTab.value
const navigationGroups: {
  label: string
  items: { id: SettingsTab; label: string }[]
}[] = [
  {
    label: '基础设置',
    items: [
      { id: 'core', label: '模型与连接' },
      { id: 'voice', label: '语音与声音' },
      { id: 'assistant', label: '对话与行为' },
    ],
  },
  {
    label: '个性与记忆',
    items: [
      { id: 'customization', label: '角色与外观' },
      { id: 'knowledge', label: '记忆与知识库' },
      { id: 'memories', label: '已保存的记忆' },
    ],
  },
  {
    label: '扩展与系统',
    items: [
      { id: 'tools', label: '自定义工具' },
      { id: 'integrations', label: '应用集成' },
      { id: 'hotkeys', label: '快捷键' },
      { id: 'storage', label: '存储与缓存' },
      { id: 'security', label: '权限与安全' },
    ],
  },
]
const pageMetadata: Record<
  SettingsTab,
  { title: string; description: string }
> = {
  core: { title: '模型与连接', description: '选择模型服务，连接你的 AI。' },
  voice: {
    title: '语音与声音',
    description: '听懂你的话，也用你喜欢的声音回答。',
  },
  assistant: {
    title: '对话与行为',
    description: '调整性格、回答方式和可使用的能力。',
  },
  customization: {
    title: '角色与外观',
    description: '换一个角色，调整画面，让陪伴更合心意。',
  },
  knowledge: {
    title: '记忆与知识库',
    description: '决定如何检索记忆，以及 Alice 可以阅读哪些文件。',
  },
  memories: {
    title: '已保存的记忆',
    description: '查看、整理和编辑你希望 Alice 记住的事。',
  },
  tools: {
    title: '自定义工具',
    description: '用自己的工具和脚本扩展 Alice 的能力。',
  },
  integrations: {
    title: '应用集成',
    description: '连接日历、邮件、搜索和其他应用。',
  },
  hotkeys: {
    title: '快捷键',
    description: '不用切换窗口，也能随时唤起 Alice。',
  },
  security: {
    title: '权限与安全',
    description: '管理执行命令的授权，保留你想要的控制。',
  },
  storage: {
    title: '存储与缓存',
    description: '选择大文件保存位置，管理本机缓存占用。',
  },
}
const pageInfo = computed(() => pageMetadata[activeTab.value])
const cloneSettings = (value: AliceSettings): AliceSettings =>
  JSON.parse(JSON.stringify(value))
const savedSnapshot = ref(JSON.stringify(settings.value))
const hasChanges = computed(
  () => JSON.stringify(currentSettings.value) !== savedSnapshot.value
)
const saveNotice = ref('')
const isCheckingConnection = ref(false)
const settingsScroll = ref<HTMLElement>()
watch(activeTab, () => {
  settingsScroll.value?.scrollTo({ top: 0 })
  saveNotice.value = ''
})
watch(
  currentSettings,
  () => {
    if (hasChanges.value) {
      saveNotice.value = ''
      settingsStore.error = null
    }
  },
  { deep: true }
)
watch(
  () => currentSettings.value.aiProvider,
  provider => {
    if (provider === settingsStore.settings.aiProvider) return
    const model = PROVIDER_CONFIGS[provider].defaultModel
    currentSettings.value.assistantModel = model
    currentSettings.value.SUMMARIZATION_MODEL = model
  }
)

const isRefreshingModels = ref(false)

const { availableModels } = storeToRefs(conversationStore)

const {
  isRecordingHotkeyFor,
  startRecordingHotkey: startRecordingHotkeyComposable,
  clearHotkey: clearHotkeyComposable,
} = useHotkeyRecording()

const { googleAuthStatus, connectGoogleServices, disconnectGoogleServices } =
  useGoogleAuth()

const availableToolsForSelect = computed(() => {
  return PREDEFINED_OPENAI_TOOLS.map(tool => {
    const functionDef = (tool as any).function || tool
    const toolInfo = getToolInfo(functionDef.name)
    return {
      name: functionDef.name,
      description: toolInfo.description,
      displayName: toolInfo.displayName,
    }
  }).filter(tool => tool.name && !CORE_ASSISTANT_TOOL_NAME_SET.has(tool.name))
})

const isBrowserContextToolActive = computed(() => {
  return currentSettings.value.assistantTools.includes('browser_context')
})

const availableModelsForSelect = computed(() => {
  const staticModels = getStaticModelsForProvider(
    currentSettings.value.aiProvider
  )
  if (staticModels.length > 0) {
    const staticModelIds = new Set(staticModels.map(model => model.id))
    return [
      ...staticModels.map((model: ProviderModelDefinition) => ({
        id: model.id,
      })),
      ...availableModels.value.filter(model => !staticModelIds.has(model.id)),
    ]
  }
  return availableModels.value
})

const toolDependencies: Record<string, string[]> = {
  search_torrents: ['VITE_JACKETT_API_KEY', 'VITE_JACKETT_URL'],
  add_torrent_to_qb: ['VITE_QB_URL', 'VITE_QB_USERNAME', 'VITE_QB_PASSWORD'],
  perform_web_search: ['VITE_TAVILY_API_KEY'],
  get_calendar_events: ['GOOGLE_AUTH'],
  create_calendar_event: ['GOOGLE_AUTH'],
  update_calendar_event: ['GOOGLE_AUTH'],
  delete_calendar_event: ['GOOGLE_AUTH'],
  get_unread_emails: ['GOOGLE_AUTH'],
  search_emails: ['GOOGLE_AUTH'],
  get_email_content: ['GOOGLE_AUTH'],
}
const refreshModels = async () => {
  if (isRefreshingModels.value) return

  isRefreshingModels.value = true
  try {
    await conversationStore.fetchModels()
  } catch (error) {
    console.error('Failed to refresh models:', error)
  } finally {
    isRefreshingModels.value = false
  }
}

function getToolInfo(name: string): {
  displayName: string
  description: string
} {
  const nameMap: Record<string, string> = {
    get_current_datetime: 'Current Date & Time',
    open_path: 'Open Apps/URLs',
    manage_clipboard: 'Clipboard Read/Write',
    save_memory: 'Save Memory',
    delete_memory: 'Delete Memory',
    recall_memories: 'Recall Memories',
    get_calendar_events: 'Get Calendar Events',
    create_calendar_event: 'Create Calendar Event',
    update_calendar_event: 'Update Calendar Event',
    delete_calendar_event: 'Delete Calendar Event',
    get_unread_emails: 'Get Unread Emails',
    search_emails: 'Search Emails',
    get_email_content: 'Get Email Content',
    search_torrents: 'Torrent Search',
    add_torrent_to_qb: 'Add Torrent to QB',
    perform_web_search: 'Web Search (Tavily)',
    searxng_web_search: 'Web Search (SearXNG)',
    read_file: 'Read Text File',
    web_fetch: 'Fetch Web Page',
    process: 'Background Process',
    delegate_task: 'Delegate to Codex',
    manage_delegated_task: 'Manage Delegated Task',
    write_text_file: 'Write Text File',
    search_files: 'Search Files',
  }

  const descriptionMap: Record<string, string> = {
    get_current_datetime: 'Allows Alice to get the current date and time',
    open_path:
      "Allows Alice to open apps, URLs, files, and folders on the user's computer",
    manage_clipboard: "Alice can read and write to the user's clipboard",
    save_memory: 'Alice can store memories (long term memory)',
    delete_memory: 'Alice can delete memories (long term memory)',
    recall_memories: 'Alice can recall memories (long term memory)',
    list_directory:
      "Alice can list the files and folders on the user's computer",
    execute_command: "Alice can execute shell commands on the user's computer",
    schedule_task: 'Alice can schedule recurring tasks or one-time reminders',
    manage_scheduled_tasks: 'Alice can manage scheduled tasks',
    get_calendar_events: 'Google Calendar integration to get calendar events',
    create_calendar_event:
      'Google Calendar integration to create calendar events',
    update_calendar_event:
      'Google Calendar integration to update calendar events',
    delete_calendar_event:
      'Google Calendar integration to delete calendar events',
    get_unread_emails: 'Google Gmail integration to get unread emails',
    search_emails: 'Google Gmail integration to search emails',
    get_email_content: 'Google Gmail integration to get email content',
    search_torrents:
      'Alice can search for torrents on the internet (requires Jackett)',
    add_torrent_to_qb:
      'Alice can add a torrent to qBittorrent (requires qBittorrent)',
    browser_context:
      'Alice can get information about the current webpage in users browser (requires browser extension)',
    perform_web_search: 'For models that lack web search capabilities (Tavily)',
    searxng_web_search:
      'For models that lack web search capabilities (SearXNG)',
    read_file: 'Alice can read an approved UTF-8 text file with size limits',
    web_fetch:
      'Alice can fetch readable text from public web pages with private-network protection',
    process: 'Alice can start and manage approved background shell processes',
    delegate_task:
      'Alice can delegate substantial read-only project analysis to a background Codex worker',
    manage_delegated_task:
      'Alice can check, retrieve, or cancel a delegated Codex task',
    write_text_file:
      'Alice can create or append approved UTF-8 files; overwriting always asks first',
    search_files:
      'Alice can perform a bounded filename and text search inside an approved directory',
  }

  return {
    displayName: t(
      nameMap[name] ||
        name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
    ),
    description: t(descriptionMap[name] || 'No description available'),
  }
}

const resetSystemPrompt = () => {
  currentSettings.value.assistantSystemPrompt = DEFAULT_ASSISTANT_PERSONA_PROMPT
}

const startRecordingHotkey = (settingKey: keyof AliceSettings) => {
  startRecordingHotkeyComposable(settingKey, currentSettings.value)
}

const clearHotkey = (settingKey: keyof AliceSettings) => {
  clearHotkeyComposable(settingKey, currentSettings.value)
}

const updateCurrentSetting = (
  key: keyof AliceSettings,
  value: string | boolean | number | string[]
) => {
  ;(currentSettings.value as any)[key] = value
}

function isToolConfigured(toolName: string): boolean {
  const currentLocalSettings = currentSettings.value
  const deps = toolDependencies[toolName]
  if (!deps) return true

  return deps.every(depKey => {
    if (depKey === 'GOOGLE_AUTH') {
      return googleAuthStatus.isAuthenticated
    }
    const value = currentLocalSettings[depKey as keyof AliceSettings]
    if (typeof value === 'string') {
      return !!value.trim()
    }
    return !!value
  })
}

onMounted(async () => {
  if (!settingsStore.initialLoadAttempted) {
    await settingsStore.loadSettings()
  }
  currentSettings.value = cloneSettings(settings.value)
  savedSnapshot.value = JSON.stringify(settings.value)

  if (
    settingsStore.coreOpenAISettingsValid &&
    conversationStore.availableModels.length === 0
  ) {
    await conversationStore.fetchModels()
  }
})

watch(
  settings,
  newSettings => {
    if (!hasChanges.value) {
      currentSettings.value = cloneSettings(newSettings)
      savedSnapshot.value = JSON.stringify(newSettings)
    } else {
      // These actions save immediately in their own panels/composables.
      // Keep them in the draft so a later appearance save cannot undo them.
      const baseline = JSON.parse(savedSnapshot.value) as AliceSettings
      currentSettings.value.approvedCommands = [...newSettings.approvedCommands]
      currentSettings.value.codexAuthConnected = newSettings.codexAuthConnected
      currentSettings.value.codexAccountLabel = newSettings.codexAccountLabel
      baseline.approvedCommands = [...newSettings.approvedCommands]
      baseline.codexAuthConnected = newSettings.codexAuthConnected
      baseline.codexAccountLabel = newSettings.codexAccountLabel
      savedSnapshot.value = JSON.stringify(baseline)
    }
  },
  { deep: true }
)

async function persistDraft(notify = true): Promise<boolean> {
  await nextTick()
  settingsStore.error = null
  const draft = cloneSettings(currentSettings.value)
  const previous = cloneSettings(settingsStore.settings)
  try {
    if (
      draft.mcpServersConfig?.trim() &&
      !Array.isArray(JSON.parse(draft.mcpServersConfig))
    )
      throw new Error('MCP 配置需要是 JSON 数组。')
    if (draft.aiProvider !== previous.aiProvider)
      settingsStore.updateSetting('aiProvider', draft.aiProvider)
    for (const key of Object.keys(draft) as (keyof AliceSettings)[]) {
      const value = draft[key]
      if (
        value !== undefined &&
        JSON.stringify(settingsStore.settings[key]) !== JSON.stringify(value)
      )
        settingsStore.updateSetting(key, value)
    }
    if (!(await settingsStore.saveSettingsToFile())) {
      Object.assign(settingsStore.settings, previous)
      return false
    }
    reinitializeClients()
    savedSnapshot.value = JSON.stringify(settingsStore.settings)
    currentSettings.value = cloneSettings(settingsStore.settings)
    if (notify && window.aliceIPC && window.location.hash === '#settings') {
      try {
        const result = await window.aliceIPC.invoke(
          'settings:notify-main-window',
          {
            type: 'settings-saved',
            success: true,
            validationComplete: false,
            settingsChanged: true,
          }
        )
        if (!result?.success) throw new Error('Main window unavailable')
      } catch {
        saveNotice.value = '已保存。主窗口未同步，重新打开 Alice 后生效。'
        return true
      }
    }
    saveNotice.value = '设置已保存。'
    return true
  } catch (error: any) {
    settingsStore.error = error?.message || '保存失败，请重试。'
    return false
  }
}

const handleSaveSettings = async () => {
  if (!settingsStore.isSaving) await persistDraft()
}
const handleCheckConnection = async () => {
  isCheckingConnection.value = true
  try {
    if (!(await persistDraft())) return
    await settingsStore.saveAndTestSettings()
    saveNotice.value = settingsStore.error ? '' : '模型连接正常。'
  } finally {
    isCheckingConnection.value = false
  }
}
</script>
