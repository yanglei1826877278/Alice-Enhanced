import rawFunctionSchemasFromFile from '../../docs/functions.json'

export interface ApiRequestBodyFunctionTool {
  type: 'function'
  name: string
  strict: boolean
  description?: string
  parameters: Record<string, any>
}

// These are Alice's built-in agent capabilities. They are always exposed to
// the model; settings only control optional integrations and user features.
export const CORE_ASSISTANT_TOOL_NAMES = [
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
] as const

export const CORE_ASSISTANT_TOOL_NAME_SET = new Set<string>(
  CORE_ASSISTANT_TOOL_NAMES
)

export const PREDEFINED_OPENAI_TOOLS: ApiRequestBodyFunctionTool[] = (
  rawFunctionSchemasFromFile as any[]
).map(schema => {
  if (
    schema.parameters &&
    schema.parameters.type === 'object' &&
    schema.parameters.additionalProperties === undefined
  ) {
    schema.parameters.additionalProperties = false
  }
  return {
    type: 'function',
    name: schema.name,
    description: schema.description,
    parameters: schema.parameters,
    strict: schema.strict ?? false,
  }
})
