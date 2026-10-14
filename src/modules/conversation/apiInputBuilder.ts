import type OpenAI from 'openai'
import type { AppChatMessageContentPart } from '../../types/chat'
import { isChatCompletionsProvider } from '../../services/llmProviders/providerCatalog'

export type ConversationHistoryRole =
  | 'user'
  | 'assistant'
  | 'system'
  | 'developer'
  | 'tool'

export interface ConversationHistoryMessage {
  local_id_temp?: string
  api_message_id?: string
  api_response_id?: string
  role: ConversationHistoryRole
  content: string | AppChatMessageContentPart[]
  tool_call_id?: string
  name?: string
  tool_calls?: any[]
}

export interface ApiInputBuilderDependencies {
  getChatHistory(): ConversationHistoryMessage[]
  getMaxHistoryMessagesForApi(): number
  getAiProvider(): string
}

export interface ApiInputBuilder {
  build(params: {
    isNewChain: boolean
  }): Promise<OpenAI.Responses.Request.InputItemLike[]>
}

export const HISTORY_CONTEXT_TOKEN_BUDGET = 16_000
const OLD_TOOL_RESULT_MAX_CHARS = 4_000

function estimateTextTokens(value: string): number {
  let cjkCharacters = 0
  let otherCharacters = 0
  for (const character of value) {
    if (
      /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u.test(
        character
      )
    ) {
      cjkCharacters += 1
    } else {
      otherCharacters += 1
    }
  }
  return cjkCharacters + Math.ceil(otherCharacters / 4)
}

function estimateMessageTokens(message: ConversationHistoryMessage): number {
  let tokens = 12
  if (typeof message.content === 'string') {
    tokens += estimateTextTokens(message.content)
  } else {
    for (const part of message.content) {
      if (part.text) tokens += estimateTextTokens(part.text)
      if (part.type === 'app_image_uri') tokens += 256
      if (part.type === 'app_file') tokens += 128
    }
  }
  if (message.tool_calls?.length) {
    tokens += estimateTextTokens(JSON.stringify(message.tool_calls))
  }
  return tokens
}

function compactOldToolResult(
  message: ConversationHistoryMessage
): ConversationHistoryMessage {
  if (message.role !== 'tool' || typeof message.content !== 'string') {
    return message
  }
  if (message.content.length <= OLD_TOOL_RESULT_MAX_CHARS) return message

  const headLength = 3_000
  const tailLength = 750
  const removed = message.content.length - headLength - tailLength
  return {
    ...message,
    content: `${message.content.slice(0, headLength)}\n\n[Older tool result truncated: ${removed} characters omitted]\n\n${message.content.slice(-tailLength)}`,
  }
}

/**
 * History is stored newest-first. Select whole user turns so tool calls and
 * their results are never separated merely because they consume extra items.
 */
export function selectHistoryForContext(
  history: ConversationHistoryMessage[],
  maxTurns: number,
  tokenBudget = HISTORY_CONTEXT_TOKEN_BUDGET
): ConversationHistoryMessage[] {
  const inferenceHistory = history.filter(message => message.role !== 'system')
  const turns: ConversationHistoryMessage[][] = []
  let currentTurn: ConversationHistoryMessage[] = []

  for (const message of inferenceHistory) {
    currentTurn.push(message)
    if (message.role === 'user') {
      turns.push(currentTurn)
      currentTurn = []
    }
  }

  // Keep an incomplete oldest fragment only when no user turn exists at all.
  if (turns.length === 0 && currentTurn.length > 0) turns.push(currentTurn)

  const selectedTurns: ConversationHistoryMessage[][] = []
  let usedTokens = 0
  const normalizedTurnLimit = Math.max(1, Math.floor(maxTurns || 1))

  for (let index = 0; index < turns.length; index += 1) {
    if (selectedTurns.length >= normalizedTurnLimit) break
    const turn = turns[index].map(message =>
      index === 0 ? message : compactOldToolResult(message)
    )
    const turnTokens = turn.reduce(
      (total, message) => total + estimateMessageTokens(message),
      0
    )

    // Always retain the current turn. Older turns remain contiguous: once the
    // next complete turn does not fit, do not create holes in the conversation.
    if (index > 0 && usedTokens + turnTokens > tokenBudget) break
    selectedTurns.push(turn)
    usedTokens += turnTokens
  }

  return selectedTurns.flat().reverse()
}

export function createApiInputBuilder(
  dependencies: ApiInputBuilderDependencies
): ApiInputBuilder {
  return {
    async build({
      isNewChain,
    }): Promise<OpenAI.Responses.Request.InputItemLike[]> {
      // `isNewChain` currently does not affect construction but kept for parity.
      void isNewChain

      const fullHistory = [...dependencies.getChatHistory()]
      const maxHistoryTurns = dependencies.getMaxHistoryMessagesForApi()
      const recentHistory = selectHistoryForContext(
        fullHistory,
        maxHistoryTurns
      )
      const apiInput: OpenAI.Responses.Request.InputItemLike[] = []

      const mostRecentUserImageMessageId = fullHistory.find(
        msg =>
          msg.role === 'user' &&
          Array.isArray(msg.content) &&
          msg.content.some(part => part.type === 'app_image_uri' && part.uri)
      )?.local_id_temp

      const aiProvider = dependencies.getAiProvider()

      for (const msg of recentHistory) {
        let apiItemPartial: any

        if (msg.role === 'system') {
          continue
        }

        if (msg.role === 'tool') {
          apiItemPartial = {
            type: 'function_call_output',
            call_id: msg.tool_call_id || `unknown_call_id_${Date.now()}`,
            output:
              typeof msg.content === 'string'
                ? msg.content
                : JSON.stringify(msg.content),
          }
        } else {
          const currentApiRole = msg.role as 'user' | 'assistant' | 'developer'
          apiItemPartial = { role: currentApiRole, content: [] }
          if (msg.name) apiItemPartial.name = msg.name

          let messageContentParts: OpenAI.Responses.Request.ContentPartLike[] =
            []

          if (typeof msg.content === 'string') {
            const typeForPart =
              currentApiRole === 'user' || currentApiRole === 'developer'
                ? 'input_text'
                : 'output_text'
            messageContentParts = [{ type: typeForPart, text: msg.content }]
          } else if (Array.isArray(msg.content)) {
            const isMostRecentUserImageMessage =
              currentApiRole === 'user' &&
              msg.local_id_temp === mostRecentUserImageMessageId

            messageContentParts = msg.content
              .map((appPart: AppChatMessageContentPart) => {
                if (appPart.type === 'app_text') {
                  const typeForPart =
                    currentApiRole === 'user' || currentApiRole === 'developer'
                      ? 'input_text'
                      : 'output_text'
                  return { type: typeForPart, text: appPart.text || '' }
                }

                if (appPart.type === 'app_image_uri') {
                  if (!appPart.uri) return null
                  if (
                    isMostRecentUserImageMessage &&
                    (currentApiRole === 'user' ||
                      currentApiRole === 'developer')
                  ) {
                    return {
                      type: 'input_image',
                      image_url: appPart.uri,
                    } as OpenAI.Responses.Request.InputImagePart
                  }

                  if (
                    currentApiRole === 'user' ||
                    currentApiRole === 'developer'
                  ) {
                    return {
                      type: 'input_text',
                      text: '[User previously sent an image]',
                    }
                  }
                  return null
                }

                if (appPart.type === 'app_file') {
                  if (!appPart.fileId) return null
                  if (
                    currentApiRole === 'user' ||
                    currentApiRole === 'developer'
                  ) {
                    return {
                      type: 'input_file',
                      file_id: appPart.fileId,
                    } as OpenAI.Responses.Request.InputFilePart
                  }
                  return null
                }

                if (appPart.type === 'app_generated_image_path') {
                  if (
                    currentApiRole !== 'user' &&
                    currentApiRole !== 'developer'
                  ) {
                    return {
                      type: 'output_text',
                      text: '[Assistant previously generated an image]',
                    }
                  }
                  return null
                }

                return null
              })
              .filter(Boolean) as OpenAI.Responses.Request.ContentPartLike[]
          }

          apiItemPartial.content =
            messageContentParts.length > 0
              ? messageContentParts
              : [
                  {
                    type:
                      currentApiRole === 'assistant'
                        ? 'output_text'
                        : 'input_text',
                    text: '',
                  },
                ]

          if (
            currentApiRole === 'assistant' &&
            msg.tool_calls &&
            isChatCompletionsProvider(aiProvider)
          ) {
            apiItemPartial.tool_calls = msg.tool_calls
          }
        }

        apiInput.push(apiItemPartial)
      }

      return apiInput
    },
  }
}
