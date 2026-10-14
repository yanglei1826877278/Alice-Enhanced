import type OpenAI from 'openai'
import type { ToolCallHandler, ToolCallHandlerDependencies } from './types'
import type { AudioState } from '../../stores/generalStore'
import { isExpectedAbortError } from '../../utils/isAbortError'
import { AGENT_RUN_LIMITS, AgentRunGuard, withTimeout } from './agentRunGuard'

const PREVIOUS_RESPONSE_NOT_FOUND = 'Previous response with id'
const NOT_FOUND_SUFFIX = 'not found'
const MAX_TOOL_IMAGES_PER_BATCH = 4

interface ToolImageInput {
  imageUrl: string
  path: string
  mimeType: string
  size: number
}

function extractToolImage(
  functionName: string,
  resultString: string
): ToolImageInput | null {
  if (functionName !== 'view_image') return null
  try {
    const result = JSON.parse(resultString)
    if (
      result?.type !== 'image' ||
      typeof result.imageUrl !== 'string' ||
      !/^data:image\/(?:png|jpeg|webp);base64,/i.test(result.imageUrl) ||
      typeof result.path !== 'string' ||
      typeof result.mimeType !== 'string' ||
      typeof result.size !== 'number'
    ) {
      return null
    }
    return {
      imageUrl: result.imageUrl,
      path: result.path,
      mimeType: result.mimeType,
      size: result.size,
    }
  } catch {
    return null
  }
}

function isPreviousResponseMissingError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const message = (error as { message?: string }).message || ''
  return (
    message.includes(PREVIOUS_RESPONSE_NOT_FOUND) &&
    message.includes(NOT_FOUND_SUFFIX)
  )
}

export function createToolCallHandler(
  dependencies: ToolCallHandlerDependencies
): ToolCallHandler {
  const runGuard = new AgentRunGuard()

  return {
    beginModelTurn: isContinuation => runGuard.beginModelTurn(isContinuation),
    canContinueWithModel: () => runGuard.canContinueWithModel(),
    getRemainingRunMs: () => runGuard.remainingMs(),
    async handleToolCalls({
      toolCalls,
      originalResponseIdForTool,
    }: {
      toolCalls: OpenAI.Responses.FunctionCall[]
      originalResponseIdForTool: string | null
    }): Promise<void> {
      const toolImages: ToolImageInput[] = []
      for (const [toolIndex, toolCall] of toolCalls.entries()) {
        if (dependencies.isAgentStopRequested()) {
          for (const skippedToolCall of toolCalls.slice(toolIndex)) {
            dependencies.addToolMessage({
              toolCallId: skippedToolCall.call_id,
              functionName: skippedToolCall.name,
              content: 'Skipped because the user stopped the active agent run.',
            })
          }
          break
        }
        if (dependencies.hasQueuedUserInput()) {
          for (const skippedToolCall of toolCalls.slice(toolIndex)) {
            dependencies.addToolMessage({
              toolCallId: skippedToolCall.call_id,
              functionName: skippedToolCall.name,
              content:
                'Skipped because the user supplied new instructions before the tool started.',
            })
          }
          break
        }
        const functionName = toolCall.name
        dependencies.updateAgentProgress('tool', functionName)
        const functionArgs =
          (toolCall.arguments as unknown as object | undefined) ?? {}
        const permit = runGuard.prepareToolCall(functionName, functionArgs)

        let resultString: string
        if (!permit.allowed) {
          resultString = `Error: ${permit.error}`
        } else {
          const statusMessage = dependencies.getToolStatusMessage(
            functionName,
            functionArgs
          )
          if (statusMessage) dependencies.addSystemMessage(statusMessage)

          try {
            resultString = await withTimeout(
              dependencies.executeFunction(functionName, functionArgs),
              permit.timeoutMs,
              `Tool ${functionName}`
            )
          } catch (error: any) {
            dependencies.logError('Tool execution failed:', error)
            const errorMessage = error?.message || 'Unknown error'
            resultString = `Error: Tool execution failed - ${errorMessage}`
          }
        }

        const toolImage = extractToolImage(functionName, resultString)
        if (toolImage) {
          const loaded = toolImages.length < MAX_TOOL_IMAGES_PER_BATCH
          if (loaded) toolImages.push(toolImage)
          resultString = JSON.stringify({
            type: 'image',
            path: toolImage.path,
            mimeType: toolImage.mimeType,
            size: toolImage.size,
            loadedIntoVisualContext: loaded,
            ...(loaded
              ? {}
              : { error: 'Only four images can be loaded in one tool batch.' }),
          })
        }

        dependencies.addToolMessage({
          toolCallId: toolCall.call_id,
          functionName,
          content: resultString,
        })

        if (dependencies.hasQueuedUserInput()) {
          for (const skippedToolCall of toolCalls.slice(toolIndex + 1)) {
            dependencies.addToolMessage({
              toolCallId: skippedToolCall.call_id,
              functionName: skippedToolCall.name,
              content:
                'Skipped because the user supplied new instructions while a tool was running.',
            })
          }
          break
        }
      }

      if (dependencies.isAgentStopRequested()) {
        dependencies.consumeAgentStopRequest()
        dependencies.addSystemMessage(
          '已按你的要求停止。正在执行的工具已安全结束，没有继续发起下一轮模型请求。'
        )
        dependencies.setAudioState(
          dependencies.isRecordingRequested() ? 'LISTENING' : 'IDLE'
        )
        return
      }

      if (!runGuard.canContinueWithModel()) {
        const placeholderTempId = dependencies.createAssistantPlaceholder()
        dependencies.updateMessageContent(placeholderTempId, [
          {
            type: 'app_text',
            text: runGuard.isExpired()
              ? 'I stopped this agent run because it reached the 5 minute time limit.'
              : `I stopped this agent run because it reached the ${AGENT_RUN_LIMITS.maxModelTurns} model turn limit.`,
          },
        ])
        dependencies.setAudioState(
          dependencies.isRecordingRequested() ? 'LISTENING' : 'IDLE'
        )
        return
      }

      const isNewChainAfterTool = dependencies.getCurrentResponseId() === null
      const queuedUserInput = dependencies.consumeQueuedUserInput()
      if (queuedUserInput) {
        dependencies.addUserIntervention(queuedUserInput)
      }
      dependencies.updateAgentProgress('waiting')
      const nextApiInput = await dependencies.buildApiInput(isNewChainAfterTool)
      if (toolImages.length > 0) {
        nextApiInput.push({
          role: 'user',
          content: toolImages.flatMap(image => [
            {
              type: 'input_text' as const,
              text: `Image loaded by view_image from ${image.path}`,
            },
            {
              type: 'input_image' as const,
              image_url: image.imageUrl,
            },
          ]),
        } as OpenAI.Responses.Request.InputItemLike)
      }

      const placeholderTempId = dependencies.createAssistantPlaceholder()

      const abortController = dependencies.createAbortController()
      dependencies.setLlmAbortController(abortController)

      const attemptContinuation = async (responseId: string | null) => {
        if (!runGuard.beginModelTurn(true)) {
          dependencies.updateMessageContent(placeholderTempId, [
            {
              type: 'app_text',
              text: runGuard.isExpired()
                ? 'I stopped this agent run because it reached the 5 minute time limit.'
                : `I stopped this agent run because it reached the ${AGENT_RUN_LIMITS.maxModelTurns} model turn limit.`,
            },
          ])
          return
        }
        const systemPrompt = dependencies.getAssistantSystemPrompt()
        const stream = await dependencies.createOpenAIResponse(
          nextApiInput,
          responseId,
          true,
          systemPrompt,
          abortController.signal
        )
        await dependencies.processStream(stream, placeholderTempId, true)
      }

      try {
        await attemptContinuation(originalResponseIdForTool)
        return
      } catch (error) {
        if (isExpectedAbortError(error)) {
          return
        }

        dependencies.logError(
          'Error in continued stream after tool call:',
          error
        )

        if (isPreviousResponseMissingError(error)) {
          dependencies.logInfo(
            '[Error Recovery] Previous response ID not found in tool continuation, clearing and starting new chain'
          )
          dependencies.setCurrentResponseId(null)

          try {
            dependencies.logInfo(
              '[Error Recovery] Retrying tool continuation without previous response ID'
            )
            await attemptContinuation(null)
            return
          } catch (retryError) {
            if (!isExpectedAbortError(retryError)) {
              dependencies.logError(
                '[Error Recovery] Retry also failed:',
                retryError
              )
            }
          }
        }

        const errorContent = dependencies.parseErrorMessage(error)
        dependencies.updateMessageContent(placeholderTempId, [errorContent])

        const nextAudioState: AudioState = dependencies.isRecordingRequested()
          ? 'LISTENING'
          : 'IDLE'
        dependencies.setAudioState(nextAudioState)
      }
    },
  }
}
