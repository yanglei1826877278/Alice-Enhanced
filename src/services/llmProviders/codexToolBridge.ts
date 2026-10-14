import { useSettingsStore } from '../../stores/settingsStore'
import { executeFunction } from '../../utils/functionCaller'

const CODEX_TOOL_RESULT_MAX_CHARS = 16_000

interface CodexToolExecuteRequest {
  requestId?: string
  tool?: string
  arguments?: any
}

interface CodexToolExecuteResult {
  requestId?: string
  success: boolean
  contentItems: Array<
    | { type: 'inputText'; text: string }
    | { type: 'inputImage'; imageUrl: string }
  >
}

let codexToolBridgeRegistered = false

function truncateToolResult(text: string): string {
  if (text.length <= CODEX_TOOL_RESULT_MAX_CHARS) {
    return text
  }

  const notice = `\n...(Alice truncated tool result: original ${text.length} chars, showing ${CODEX_TOOL_RESULT_MAX_CHARS}.)`
  return `${text.slice(
    0,
    Math.max(0, CODEX_TOOL_RESULT_MAX_CHARS - notice.length)
  )}${notice}`
}

function createToolResult(
  requestId: string | undefined,
  text: string,
  success: boolean
): CodexToolExecuteResult {
  return {
    requestId,
    success,
    contentItems: [
      {
        type: 'inputText',
        text: truncateToolResult(text),
      },
    ],
  }
}

function createImageToolResult(
  requestId: string | undefined,
  resultText: string
): CodexToolExecuteResult | null {
  try {
    const result = JSON.parse(resultText)
    if (
      result?.type !== 'image' ||
      typeof result.imageUrl !== 'string' ||
      !/^data:image\/(?:png|jpeg|webp);base64,/i.test(result.imageUrl)
    ) {
      return null
    }
    return {
      requestId,
      success: true,
      contentItems: [
        {
          type: 'inputText',
          text: `Image loaded from ${String(result.path || 'local file')}.`,
        },
        { type: 'inputImage', imageUrl: result.imageUrl },
      ],
    }
  } catch {
    return null
  }
}

async function respondToCodexToolCall(
  result: CodexToolExecuteResult
): Promise<void> {
  await window.aliceIPC.invoke('codex-tool:result', result)
}

export function registerCodexToolBridge(): void {
  if (
    codexToolBridgeRegistered ||
    typeof window === 'undefined' ||
    !window.aliceIPC
  ) {
    return
  }

  codexToolBridgeRegistered = true
  window.aliceIPC.on(
    'codex-tool:execute',
    async (request: CodexToolExecuteRequest) => {
      const requestId = request?.requestId
      const toolName = request?.tool

      if (!toolName) {
        await respondToCodexToolCall(
          createToolResult(
            requestId,
            'Error: Codex did not specify a tool.',
            false
          )
        )
        return
      }

      try {
        const settings = useSettingsStore().config
        const resultText = await executeFunction(
          toolName,
          request.arguments || {},
          settings
        )
        const success = !resultText.trim().toLowerCase().startsWith('error')
        const imageResult =
          toolName === 'view_image'
            ? createImageToolResult(requestId, resultText)
            : null
        await respondToCodexToolCall(
          imageResult || createToolResult(requestId, resultText, success)
        )
      } catch (error: any) {
        await respondToCodexToolCall(
          createToolResult(
            requestId,
            `Error executing ${toolName}: ${error?.message || String(error)}`,
            false
          )
        )
      }
    }
  )
}
