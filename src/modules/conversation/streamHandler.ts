import type {
  ConversationStreamHandler,
  StreamHandlerDependencies,
  StreamProcessingOptions,
  StreamProcessingResult,
} from './types'
import { isExpectedAbortError } from '../../utils/isAbortError'

const SENTENCE_END_REGEX = /[.!?。！？；][”’"'）)\]}】》」』]*\s*$/

export function createStreamHandler(
  dependencies: StreamHandlerDependencies
): ConversationStreamHandler {
  return {
    async process({
      stream,
      options,
    }: {
      stream: AsyncIterable<any>
      options?: StreamProcessingOptions
    }): Promise<StreamProcessingResult> {
      let currentSentence = ''
      let currentAssistantMessageId: string | null = null
      const functionCallArgsBuffer = new Map<string, string>()
      const completedToolCalls: any[] = []
      let streamEndedNormally = true

      const flushSentence = async () => {
        if (!currentSentence.trim()) return
        // Synthesis is handled by its own ordered worker. Do not pause the LLM
        // stream while the current sentence is being turned into audio.
        void dependencies.enqueueSpeech(currentSentence)
        currentSentence = ''
      }

      try {
        for await (const event of stream) {
          if (event.type === 'response.connection.established') {
            dependencies.updateAgentProgress('connected')
          } else if (event.type === 'response.stream_activity') {
            dependencies.updateAgentProgress()
          } else if (
            event.type === 'response.reasoning.delta' ||
            event.type?.includes?.('reasoning')
          ) {
            dependencies.updateAgentProgress('reasoning')
          }

          if (event.type === 'response.created') {
            dependencies.updateAgentProgress('waiting')
            dependencies.setAssistantResponseId(event.response.id)
          }

          if (
            event.type === 'response.output_item.added' ||
            event.type === 'response.output_item.updated'
          ) {
            if (
              event.item.type === 'message' &&
              event.item.role === 'assistant'
            ) {
              currentAssistantMessageId = event.item.id
              dependencies.setAssistantMessageId(event.item.id)
            }
          }

          if (
            event.type === 'response.output_text.delta' &&
            event.item_id === currentAssistantMessageId
          ) {
            const textChunk = event.delta || ''
            if (!textChunk) {
              continue
            }
            currentSentence += textChunk
            dependencies.updateAgentProgress('responding')
            dependencies.appendAssistantDelta(textChunk)

            if (
              SENTENCE_END_REGEX.test(textChunk) ||
              textChunk.includes('\n')
            ) {
              await flushSentence()
            }
          }

          if (event.type === 'response.function_call_arguments.delta') {
            dependencies.updateAgentProgress('tool')
            const itemId = event.item_id
            const previous = functionCallArgsBuffer.get(itemId) ?? ''
            functionCallArgsBuffer.set(itemId, previous + (event.delta || ''))
          }

          if (
            event.type === 'response.output_item.done' &&
            event.item.type === 'function_call'
          ) {
            const functionCallPayload = { ...event.item }
            const argsRaw = functionCallArgsBuffer.get(functionCallPayload.id)
            if (argsRaw) {
              try {
                functionCallPayload.arguments = JSON.parse(argsRaw)
              } catch (error) {
                dependencies.handleStreamError(
                  new Error(
                    `Failed to parse function call arguments: ${String(error)}`
                  )
                )
              }
            }

            dependencies.addToolCall(functionCallPayload)
            completedToolCalls.push(functionCallPayload)
          }

          if (event.type === 'response.image_generation_call.in_progress') {
            dependencies.setAudioState('GENERATING_IMAGE')
          }

          if (event.type === 'response.image_generation_call.partial_image') {
            const imageGenerationId = event.item_id
            const base64Content = event.partial_image_b64
            const partialIndex = event.partial_image_index + 1
            await dependencies.handleImagePartial(
              imageGenerationId,
              base64Content,
              partialIndex
            )
          }

          if (
            event.type === 'response.output_item.done' &&
            event.item?.type === 'image_generation_call'
          ) {
            const imageItem = event.item
            if (imageItem.result) {
              await dependencies.handleImageFinal(
                imageItem.id,
                imageItem.result
              )

              if (dependencies.getAudioState() === 'GENERATING_IMAGE') {
                dependencies.setAudioState('WAITING_FOR_RESPONSE')
              }
            }
          }

          if (event.type === 'error') {
            streamEndedNormally = false
            dependencies.handleStreamError(event.error)
            break
          }
        }

        await flushSentence()
        if (streamEndedNormally && completedToolCalls.length > 0) {
          await dependencies.handleToolCalls(completedToolCalls)
        }
      } catch (error: any) {
        if (isExpectedAbortError(error)) {
          return { streamEndedNormally: false }
        }
        streamEndedNormally = false
        dependencies.handleStreamError(error)
      }

      return { streamEndedNormally }
    },
  }
}
