import { useSettingsStore } from '../../stores/settingsStore'
import { useCustomToolsStore } from '../../stores/customToolsStore'
import {
  CORE_ASSISTANT_TOOL_NAMES,
  PREDEFINED_OPENAI_TOOLS,
  type ApiRequestBodyFunctionTool,
} from '../../utils/assistantTools'
import { PROVIDER_CONFIGS } from './providerCatalog'
import { getSkills } from '../skills'
import { getActiveMemoryMode } from '../memoryModeRuntime'

const OPENAI_IMAGE_GENERATION_MODEL = 'gpt-image-2'

export async function buildToolsForProvider(): Promise<any[]> {
  const settings = useSettingsStore().config
  const finalToolsForApi: any[] = []

  const requestedToolNames = new Set<string>([
    ...CORE_ASSISTANT_TOOL_NAMES,
    ...(settings.assistantTools || []),
  ])

  if (requestedToolNames.size > 0) {
    for (const toolName of requestedToolNames) {
      if (
        getActiveMemoryMode() !== 'long-term' &&
        ['save_memory', 'delete_memory', 'recall_memories'].includes(toolName)
      ) {
        continue
      }
      const toolDefinition = PREDEFINED_OPENAI_TOOLS.find(
        (tool: ApiRequestBodyFunctionTool) => tool.name === toolName
      )
      if (toolDefinition) {
        finalToolsForApi.push({
          type: 'function',
          name: toolDefinition.name,
          description: toolDefinition.description,
          parameters: toolDefinition.parameters,
        })
      }
    }
  }

  const customToolsStore = useCustomToolsStore()
  await customToolsStore.ensureInitialized()
  for (const customTool of customToolsStore.enabledAndValidTools) {
    finalToolsForApi.push({
      type: 'function',
      name: customTool.name,
      description: customTool.description,
      parameters: customTool.parameters,
      strict: customTool.strict ?? false,
    })
  }

  const installedSkills = (await getSkills()).skills.filter(
    skill => skill.enabled && skill.isValid
  )
  const skillCatalog = installedSkills.filter(skill => !skill.manualOnly)
  if (skillCatalog.length) {
    const catalog = skillCatalog
      .map(skill => `${skill.name}: ${skill.description}`)
      .join('\n')
      .slice(0, 8000)
    finalToolsForApi.push({
      type: 'function',
      name: 'activate_skill',
      description: `Load a relevant Agent Skill's complete SKILL.md instructions before following its workflow. Available skills:\n${catalog}`,
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Exact skill name' },
        },
        required: ['name'],
        additionalProperties: false,
      },
    })
  }
  if (installedSkills.length) {
    finalToolsForApi.push({
      type: 'function',
      name: 'read_skill_file',
      description:
        'Read a text file referenced by an activated skill. Paths are relative to that skill directory.',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string' }, file: { type: 'string' } },
        required: ['name', 'file'],
        additionalProperties: false,
      },
    })
  }

  if (
    settings.mcpServersConfig &&
    settings.mcpServersConfig.trim() !== '[]' &&
    settings.mcpServersConfig.trim() !== ''
  ) {
    try {
      const mcpServerDefinitions = JSON.parse(settings.mcpServersConfig)
      if (Array.isArray(mcpServerDefinitions)) {
        mcpServerDefinitions.forEach(mcpTool => {
          if (
            mcpTool.type === 'mcp' &&
            mcpTool.server_label &&
            mcpTool.server_url
          ) {
            finalToolsForApi.push(mcpTool)
          }
        })
      }
    } catch (e) {
      console.error('Failed to parse MCP servers config JSON:', e)
    }
  }

  const modelName = settings.assistantModel || ''
  const isOModel = modelName.startsWith('o')

  if (settings.aiProvider === 'openai') {
    const isGpt5WithMinimalReasoning =
      settings.assistantModel.startsWith('gpt-5') &&
      settings.assistantReasoningEffort === 'minimal'

    if (!isOModel) {
      if (!isGpt5WithMinimalReasoning) {
        finalToolsForApi.push({
          type: 'image_generation',
          model: OPENAI_IMAGE_GENERATION_MODEL,
          partial_images: 2,
        })
        finalToolsForApi.push({ type: 'web_search_preview' })
      }
    } else {
      if (modelName.includes('o3-pro') && modelName === 'o3') {
        finalToolsForApi.push({
          type: 'image_generation',
          model: OPENAI_IMAGE_GENERATION_MODEL,
          partial_images: 2,
        })
        finalToolsForApi.push({ type: 'web_search_preview' })
      }
    }
  }

  if (settings.aiProvider === 'openrouter') {
    const allowedTools = finalToolsForApi
      .filter(tool => {
        if (
          tool.type === 'image_generation' ||
          tool.type === 'web_search_preview' ||
          tool.name === 'perform_web_search'
        ) {
          return false
        }
        return true
      })
      .map(tool => {
        if (tool.name === 'open_path') {
          return {
            ...tool,
            description: tool.description?.replace(
              'Use this tool to open web search result url for user command.',
              'Do NOT use this tool for web searches. For web searches, use the built-in web search capabilities.'
            ),
          }
        }
        return tool
      })
    allowedTools.push({ type: 'openrouter:web_search' })
    finalToolsForApi.length = 0
    finalToolsForApi.push(...allowedTools)
  } else if (!PROVIDER_CONFIGS[settings.aiProvider].nativeWebSearch) {
    const allowedTools = finalToolsForApi.filter(tool => {
      if (
        tool.type === 'image_generation' ||
        tool.type === 'web_search_preview'
      ) {
        return false
      }
      return true
    })
    finalToolsForApi.length = 0
    finalToolsForApi.push(...allowedTools)
  }

  return finalToolsForApi
}
