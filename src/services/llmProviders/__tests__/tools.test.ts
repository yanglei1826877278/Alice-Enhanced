import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useSettingsStore } from '../../../stores/settingsStore'
import { setActiveMemoryMode } from '../../memoryModeRuntime'

function installWindowMocks() {
  ;(globalThis as any).window = {
    customToolsAPI: {
      list: vi.fn().mockResolvedValue({
        success: true,
        data: {
          tools: [],
          diagnostics: [],
          filePath: '',
          lastModified: Date.now(),
        },
      }),
    },
  }
}

describe('buildToolsForProvider', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    setActiveMemoryMode('session')
    installWindowMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    delete (globalThis as any).window
  })

  it('uses GPT Image 2 for OpenAI image generation', async () => {
    const settingsStore = useSettingsStore()
    settingsStore.updateSetting('aiProvider', 'openai')
    settingsStore.updateSetting('assistantModel', 'gpt-5')
    settingsStore.updateSetting('assistantReasoningEffort', 'medium')

    const { buildToolsForProvider } = await import('../tools')
    const tools = await buildToolsForProvider()

    expect(tools).toContainEqual({
      type: 'image_generation',
      model: 'gpt-image-2',
      partial_images: 2,
    })
  })

  it('always exposes the lightweight core agent tools without settings opt-in', async () => {
    const settingsStore = useSettingsStore()
    settingsStore.updateSetting('aiProvider', 'custom')
    settingsStore.updateSetting('assistantTools', [])

    const { buildToolsForProvider } = await import('../tools')
    const tools = await buildToolsForProvider()
    const names = tools.map(tool => tool.name).filter(Boolean)

    expect(names).toEqual(
      expect.arrayContaining([
        'get_current_datetime',
        'list_directory',
        'read_file',
        'view_image',
        'write_text_file',
        'search_files',
        'execute_command',
        'process',
        'web_fetch',
        'delegate_task',
        'manage_delegated_task',
        'schedule_task',
        'manage_scheduled_tasks',
      ])
    )
  })

  it('does not duplicate a core tool left in an older saved setting', async () => {
    const settingsStore = useSettingsStore()
    settingsStore.updateSetting('aiProvider', 'custom')
    settingsStore.updateSetting('assistantTools', [
      'read_file',
      'get_current_datetime',
    ])

    const { buildToolsForProvider } = await import('../tools')
    const tools = await buildToolsForProvider()

    expect(tools.filter(tool => tool.name === 'read_file')).toHaveLength(1)
    expect(
      tools.filter(tool => tool.name === 'get_current_datetime')
    ).toHaveLength(1)
  })

  it('uses OpenRouter server-side web search instead of the Tavily function', async () => {
    const settingsStore = useSettingsStore()
    settingsStore.updateSetting('aiProvider', 'openrouter')
    settingsStore.updateSetting('assistantTools', ['perform_web_search'])

    const { buildToolsForProvider } = await import('../tools')
    const tools = await buildToolsForProvider()

    expect(tools).toContainEqual({ type: 'openrouter:web_search' })
    expect(tools).not.toContainEqual(
      expect.objectContaining({ name: 'perform_web_search' })
    )
  })

  it('exposes long-term memory tools only in long-term mode', async () => {
    const settingsStore = useSettingsStore()
    settingsStore.updateSetting('aiProvider', 'custom')
    settingsStore.updateSetting('assistantTools', [
      'save_memory',
      'delete_memory',
      'recall_memories',
      'get_current_datetime',
    ])

    const { buildToolsForProvider } = await import('../tools')

    setActiveMemoryMode('session')
    const sessionTools = await buildToolsForProvider()
    expect(sessionTools.some(tool => tool.name === 'save_memory')).toBe(false)
    expect(sessionTools.some(tool => tool.name === 'recall_memories')).toBe(false)
    expect(sessionTools.some(tool => tool.name === 'get_current_datetime')).toBe(
      true
    )

    setActiveMemoryMode('long-term')
    const longTermTools = await buildToolsForProvider()
    expect(longTermTools.some(tool => tool.name === 'save_memory')).toBe(true)
    expect(longTermTools.some(tool => tool.name === 'delete_memory')).toBe(true)
    expect(longTermTools.some(tool => tool.name === 'recall_memories')).toBe(true)
  })

  it('offers enabled skills for activation and leaves manual-only skills out of the catalog', async () => {
    ;(window as any).skillsAPI = {
      list: vi.fn().mockResolvedValue({
        success: true,
        data: {
          installRoot: '/skills',
          diagnostics: [],
          skills: [
            {
              name: 'review',
              description: 'Review code changes.',
              enabled: true,
              isValid: true,
              manualOnly: false,
            },
            {
              name: 'deploy',
              description: 'Deploy app.',
              enabled: true,
              isValid: true,
              manualOnly: true,
            },
          ],
        },
      }),
    }
    const { buildToolsForProvider } = await import('../tools')
    const tools = await buildToolsForProvider()
    const activation = tools.find(tool => tool.name === 'activate_skill')
    expect(activation.description).toContain('review: Review code changes.')
    expect(activation.description).not.toContain('deploy: Deploy app.')
    expect(tools.some(tool => tool.name === 'read_skill_file')).toBe(true)
  })
})
