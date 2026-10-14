export const AGENT_RUN_LIMITS = {
  maxModelTurns: 10,
  maxToolCalls: 20,
  maxIdenticalCalls: 2,
  maxRunDurationMs: 5 * 60_000,
} as const

export const TOOL_TIMEOUTS = {
  local: 10_000,
  filesystem: 15_000,
  network: 30_000,
  shell: 60_000,
  generation: 120_000,
  delegation: 15_000,
} as const

export type ToolCategory = keyof typeof TOOL_TIMEOUTS

const LOCAL_TOOLS = new Set(['get_current_datetime', 'manage_clipboard'])
const FILESYSTEM_TOOLS = new Set([
  'open_path',
  'list_directory',
  'read_skill_file',
  'activate_skill',
  'read_file',
  'view_image',
  'write_text_file',
  'search_files',
])
const SHELL_TOOLS = new Set(['execute_command', 'process'])
const NETWORK_TOOLS = new Set([
  'save_memory',
  'delete_memory',
  'recall_memories',
  'search_torrents',
  'add_torrent_to_qb',
  'get_calendar_events',
  'create_calendar_event',
  'update_calendar_event',
  'delete_calendar_event',
  'get_unread_emails',
  'search_emails',
  'get_email_content',
  'schedule_task',
  'manage_scheduled_tasks',
  'browser_context',
  'perform_web_search',
  'searxng_web_search',
  'web_fetch',
])

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableValue(entry)])
    )
  }
  return value
}

export function canonicalizeToolArgs(args: unknown): string {
  if (typeof args === 'string') {
    try {
      return JSON.stringify(stableValue(JSON.parse(args)))
    } catch {
      return args.trim()
    }
  }
  return JSON.stringify(stableValue(args ?? {}))
}

export function classifyTool(toolName: string): ToolCategory {
  if (SHELL_TOOLS.has(toolName)) return 'shell'
  if (LOCAL_TOOLS.has(toolName)) return 'local'
  if (FILESYSTEM_TOOLS.has(toolName)) return 'filesystem'
  if (/delegate|handoff|agent|codex/i.test(toolName)) return 'delegation'
  if (/generate|image|video|audio|speech/i.test(toolName)) return 'generation'
  if (NETWORK_TOOLS.has(toolName)) return 'network'
  return 'network'
}

export interface ToolCallPermit {
  allowed: boolean
  fingerprint: string
  timeoutMs: number
  error?: string
}

export class AgentRunGuard {
  private startedAt: number | null = null
  private modelTurns = 0
  private toolCalls = 0
  private readonly identicalCalls = new Map<string, number>()

  beginModelTurn(isContinuation: boolean): boolean {
    if (!isContinuation || this.startedAt === null) this.reset()
    if (this.isExpired() || this.modelTurns >= AGENT_RUN_LIMITS.maxModelTurns) {
      return false
    }
    this.modelTurns += 1
    return true
  }

  canContinueWithModel(): boolean {
    return (
      !this.isExpired() &&
      this.modelTurns < AGENT_RUN_LIMITS.maxModelTurns
    )
  }

  prepareToolCall(toolName: string, args: unknown): ToolCallPermit {
    const fingerprint = `${toolName}:${canonicalizeToolArgs(args)}`
    const timeoutMs = Math.min(
      TOOL_TIMEOUTS[classifyTool(toolName)],
      this.remainingMs()
    )

    if (this.isExpired()) {
      return {
        allowed: false,
        fingerprint,
        timeoutMs: 0,
        error: 'Agent run stopped: the 5 minute time limit was reached.',
      }
    }

    this.toolCalls += 1
    if (this.toolCalls > AGENT_RUN_LIMITS.maxToolCalls) {
      return {
        allowed: false,
        fingerprint,
        timeoutMs,
        error: `Agent run stopped: the ${AGENT_RUN_LIMITS.maxToolCalls} tool call limit was reached.`,
      }
    }

    const identicalCount = (this.identicalCalls.get(fingerprint) ?? 0) + 1
    this.identicalCalls.set(fingerprint, identicalCount)
    if (identicalCount > AGENT_RUN_LIMITS.maxIdenticalCalls) {
      return {
        allowed: false,
        fingerprint,
        timeoutMs,
        error:
          'Tool call blocked: the same tool and arguments were already executed twice without sufficient progress.',
      }
    }

    return { allowed: true, fingerprint, timeoutMs }
  }

  remainingMs(): number {
    if (this.startedAt === null) return AGENT_RUN_LIMITS.maxRunDurationMs
    return Math.max(
      0,
      AGENT_RUN_LIMITS.maxRunDurationMs - (Date.now() - this.startedAt)
    )
  }

  isExpired(): boolean {
    return this.remainingMs() <= 0
  }

  reset(): void {
    this.startedAt = Date.now()
    this.modelTurns = 0
    this.toolCalls = 0
    this.identicalCalls.clear()
  }
}

export async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  if (timeoutMs <= 0) {
    throw new Error(`${label} timed out before it could start.`)
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`${label} timed out after ${timeoutMs}ms.`)),
          timeoutMs
        )
      }),
    ])
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
  }
}
