import { describe, expect, it, vi } from 'vitest'
import type OpenAI from 'openai'
import { createToolCallHandler } from '../toolCallHandler'
import type { ToolCallHandlerDependencies } from '../types'

function createAsyncStream<T>(events: T[]): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        yield event
      }
    },
  }
}

function createToolCall(
  overrides: Partial<OpenAI.Responses.FunctionCall> = {}
): OpenAI.Responses.FunctionCall {
  return {
    id: 'func_call_1',
    type: 'function_call',
    call_id: 'call_1',
    name: 'testTool',
    arguments: {},
    output: '',
    ...overrides,
  } as OpenAI.Responses.FunctionCall
}

function setupHandler({
  currentResponseId = 'resp_123',
  isRecordingRequested = false,
  executeFunctionImpl,
  createOpenAIResponseImpl,
}: {
  currentResponseId?: string | null
  isRecordingRequested?: boolean
  executeFunctionImpl?: (name: string, args: object) => Promise<string>
  createOpenAIResponseImpl?: (
    input: OpenAI.Responses.Request.InputItemLike[],
    responseId: string | null
  ) => Promise<AsyncIterable<OpenAI.Responses.StreamEvent>>
} = {}) {
  let responseIdRef = currentResponseId
  const abortController = new AbortController()

  const spies = {
    getToolStatusMessage: vi.fn().mockReturnValue('status message'),
    addSystemMessage: vi.fn(),
    addUserIntervention: vi.fn(),
    consumeQueuedUserInput: vi.fn().mockReturnValue(''),
    hasQueuedUserInput: vi.fn().mockReturnValue(false),
    isAgentStopRequested: vi.fn().mockReturnValue(false),
    consumeAgentStopRequest: vi.fn().mockReturnValue(false),
    addToolMessage: vi.fn(),
    executeFunction: vi
      .fn()
      .mockImplementation(executeFunctionImpl || (async () => 'tool result')),
    buildApiInput: vi
      .fn()
      .mockResolvedValue([
        { role: 'user', content: [] },
      ] as OpenAI.Responses.Request.InputItemLike[]),
    createAssistantPlaceholder: vi.fn().mockReturnValue('placeholder'),
    createAbortController: vi.fn().mockReturnValue(abortController),
    setLlmAbortController: vi.fn(),
    createOpenAIResponse: vi
      .fn()
      .mockImplementation(
        createOpenAIResponseImpl ||
          (async () => createAsyncStream([{ type: 'done' }]))
      ),
    processStream: vi.fn().mockResolvedValue(undefined),
    parseErrorMessage: vi
      .fn()
      .mockReturnValue({ type: 'app_error', text: 'error' }),
    updateMessageContent: vi.fn(),
    setAudioState: vi.fn(),
    isRecordingRequested: vi.fn(() => isRecordingRequested),
    getAssistantSystemPrompt: vi.fn(() => 'system prompt'),
    getCurrentResponseId: vi.fn(() => responseIdRef),
    setCurrentResponseId: vi.fn((value: string | null) => {
      responseIdRef = value
    }),
    logError: vi.fn(),
    logInfo: vi.fn(),
    updateAgentProgress: vi.fn(),
  }

  const dependencies: ToolCallHandlerDependencies = {
    getToolStatusMessage: spies.getToolStatusMessage,
    addSystemMessage: spies.addSystemMessage,
    addUserIntervention: spies.addUserIntervention,
    consumeQueuedUserInput: spies.consumeQueuedUserInput,
    hasQueuedUserInput: spies.hasQueuedUserInput,
    isAgentStopRequested: spies.isAgentStopRequested,
    consumeAgentStopRequest: spies.consumeAgentStopRequest,
    addToolMessage: spies.addToolMessage,
    executeFunction: spies.executeFunction,
    buildApiInput: spies.buildApiInput,
    createAssistantPlaceholder: spies.createAssistantPlaceholder,
    createAbortController: spies.createAbortController,
    setLlmAbortController: spies.setLlmAbortController,
    createOpenAIResponse: async (
      input,
      responseId,
      isContinuationAfterTool,
      systemPrompt,
      signal
    ) => {
      expect(isContinuationAfterTool).toBe(true)
      expect(systemPrompt).toBe('system prompt')
      expect(signal).toBe(abortController.signal)
      return spies.createOpenAIResponse(input, responseId)
    },
    processStream: spies.processStream,
    parseErrorMessage: spies.parseErrorMessage,
    updateMessageContent: spies.updateMessageContent,
    setAudioState: spies.setAudioState,
    isRecordingRequested: spies.isRecordingRequested,
    getAssistantSystemPrompt: spies.getAssistantSystemPrompt,
    getCurrentResponseId: spies.getCurrentResponseId,
    setCurrentResponseId: spies.setCurrentResponseId,
    logError: spies.logError,
    logInfo: spies.logInfo,
    updateAgentProgress: spies.updateAgentProgress,
  }

  const handler = createToolCallHandler(dependencies)
  handler.beginModelTurn(false)

  return { handler, spies, abortController }
}

describe('createToolCallHandler', () => {
  it('executes a collected batch serially and continues only once', async () => {
    const executionOrder: string[] = []
    const { handler, spies } = setupHandler({
      executeFunctionImpl: async name => {
        executionOrder.push(name)
        return `${name} result`
      },
    })

    await handler.handleToolCalls({
      toolCalls: [
        createToolCall({ call_id: 'call_1', name: 'first' }),
        createToolCall({ call_id: 'call_2', name: 'second' }),
      ],
      originalResponseIdForTool: 'resp_123',
    })

    expect(executionOrder).toEqual(['first', 'second'])
    expect(spies.addToolMessage).toHaveBeenCalledTimes(2)
    expect(spies.createOpenAIResponse).toHaveBeenCalledTimes(1)
    expect(spies.processStream).toHaveBeenCalledTimes(1)
  })

  it('executes tool call and continues conversation successfully', async () => {
    const { handler, spies, abortController } = setupHandler()
    const toolCall = createToolCall()

    await handler.handleToolCalls({
      toolCalls: [toolCall],
      originalResponseIdForTool: 'resp_123',
    })

    expect(spies.getToolStatusMessage).toHaveBeenCalledWith('testTool', {})
    expect(spies.addSystemMessage).toHaveBeenCalledWith('status message')
    expect(spies.executeFunction).toHaveBeenCalledWith('testTool', {})
    expect(spies.addToolMessage).toHaveBeenCalledWith({
      toolCallId: 'call_1',
      functionName: 'testTool',
      content: 'tool result',
    })
    expect(spies.buildApiInput).toHaveBeenCalledWith(false)
    expect(spies.createAssistantPlaceholder).toHaveBeenCalled()
    expect(spies.createAbortController).toHaveBeenCalled()
    expect(spies.setLlmAbortController).toHaveBeenCalledWith(abortController)
    expect(spies.createOpenAIResponse).toHaveBeenCalledWith(
      expect.any(Array),
      'resp_123'
    )
    expect(spies.processStream).toHaveBeenCalledWith(
      expect.any(Object),
      'placeholder',
      true
    )
    expect(spies.updateMessageContent).not.toHaveBeenCalled()
  })

  it('injects queued user speech at the tool continuation boundary', async () => {
    const { handler, spies } = setupHandler()
    spies.consumeQueuedUserInput.mockReturnValueOnce('路径改成 D:\\project')

    await handler.handleToolCalls({
      toolCalls: [
        createToolCall(),
        createToolCall({ call_id: 'call_2', name: 'second' }),
      ],
      originalResponseIdForTool: 'resp_123',
    })

    expect(spies.addUserIntervention).toHaveBeenCalledWith(
      '路径改成 D:\\project'
    )
    expect(spies.addUserIntervention.mock.invocationCallOrder[0]).toBeLessThan(
      spies.buildApiInput.mock.invocationCallOrder[0]
    )
  })

  it('skips later tools in a batch when steering arrives during execution', async () => {
    const { handler, spies } = setupHandler({
      executeFunctionImpl: async () => {
        spies.hasQueuedUserInput.mockReturnValue(true)
        return 'first result'
      },
    })
    spies.consumeQueuedUserInput.mockReturnValueOnce('先改另一个路径')

    await handler.handleToolCalls({
      toolCalls: [
        createToolCall({ call_id: 'call_1', name: 'first' }),
        createToolCall({ call_id: 'call_2', name: 'second' }),
      ],
      originalResponseIdForTool: 'resp_123',
    })

    expect(spies.executeFunction).toHaveBeenCalledTimes(1)
    expect(spies.addToolMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        toolCallId: 'call_2',
        content: expect.stringContaining('Skipped'),
      })
    )
    expect(spies.addUserIntervention).toHaveBeenCalledWith('先改另一个路径')
  })

  it('skips the whole tool batch when steering arrived before execution', async () => {
    const { handler, spies } = setupHandler()
    spies.hasQueuedUserInput.mockReturnValue(true)
    spies.consumeQueuedUserInput.mockReturnValueOnce('不要执行，先解释')

    await handler.handleToolCalls({
      toolCalls: [createToolCall({ name: 'write_text_file' })],
      originalResponseIdForTool: 'resp_123',
    })

    expect(spies.executeFunction).not.toHaveBeenCalled()
    expect(spies.addToolMessage).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Skipped') })
    )
    expect(spies.addUserIntervention).toHaveBeenCalledWith('不要执行，先解释')
  })

  it('stops after the active tool instead of starting another model turn', async () => {
    const { handler, spies } = setupHandler({
      executeFunctionImpl: async () => {
        spies.isAgentStopRequested.mockReturnValue(true)
        return 'tool safely finished'
      },
    })

    await handler.handleToolCalls({
      toolCalls: [
        createToolCall(),
        createToolCall({ call_id: 'call_2', name: 'second' }),
      ],
      originalResponseIdForTool: 'resp_123',
    })

    expect(spies.consumeAgentStopRequest).toHaveBeenCalled()
    expect(spies.createOpenAIResponse).not.toHaveBeenCalled()
    expect(spies.addSystemMessage).toHaveBeenCalledWith(
      expect.stringContaining('停止')
    )
    expect(spies.addToolMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        toolCallId: 'call_2',
        content: expect.stringContaining('stopped'),
      })
    )
  })

  it('adds view_image output to the continuation as real visual input', async () => {
    const imageUrl = 'data:image/png;base64,aW1hZ2U='
    const { handler, spies } = setupHandler({
      executeFunctionImpl: async () =>
        JSON.stringify({
          type: 'image',
          path: 'C:\\images\\sample.png',
          mimeType: 'image/png',
          size: 5,
          imageUrl,
        }),
    })

    await handler.handleToolCalls({
      toolCalls: [createToolCall({ name: 'view_image' })],
      originalResponseIdForTool: 'resp_123',
    })

    expect(spies.addToolMessage).toHaveBeenCalledWith({
      toolCallId: 'call_1',
      functionName: 'view_image',
      content: JSON.stringify({
        type: 'image',
        path: 'C:\\images\\sample.png',
        mimeType: 'image/png',
        size: 5,
        loadedIntoVisualContext: true,
      }),
    })
    const continuationInput = spies.createOpenAIResponse.mock.calls[0][0]
    expect(continuationInput).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'user',
          content: expect.arrayContaining([
            { type: 'input_image', image_url: imageUrl },
          ]),
        }),
      ])
    )
  })

  it('falls back to error string when tool execution fails', async () => {
    const error = new Error('boom')
    const { handler, spies } = setupHandler({
      executeFunctionImpl: async () => {
        throw error
      },
    })

    await handler.handleToolCalls({
      toolCalls: [createToolCall()],
      originalResponseIdForTool: null,
    })

    expect(spies.logError).toHaveBeenCalledWith('Tool execution failed:', error)
    expect(spies.addToolMessage).toHaveBeenCalledWith({
      toolCallId: 'call_1',
      functionName: 'testTool',
      content: 'Error: Tool execution failed - boom',
    })
  })

  it('retries continuation when previous response is missing', async () => {
    const retryStream = createAsyncStream([{ type: 'retry-success' }])
    const { handler, spies } = setupHandler({
      createOpenAIResponseImpl: vi
        .fn()
        .mockRejectedValueOnce(
          Object.assign(new Error('Previous response with id xyz not found'), {
            message: 'Previous response with id xyz not found',
          })
        )
        .mockResolvedValueOnce(retryStream),
    })

    await handler.handleToolCalls({
      toolCalls: [createToolCall()],
      originalResponseIdForTool: 'resp_999',
    })

    expect(spies.logInfo).toHaveBeenCalledWith(
      '[Error Recovery] Previous response ID not found in tool continuation, clearing and starting new chain'
    )
    expect(spies.setCurrentResponseId).toHaveBeenCalledWith(null)
    expect(spies.createOpenAIResponse).toHaveBeenNthCalledWith(
      1,
      expect.any(Array),
      'resp_999'
    )
    expect(spies.createOpenAIResponse).toHaveBeenNthCalledWith(
      2,
      expect.any(Array),
      null
    )
    expect(spies.processStream).toHaveBeenCalledTimes(1)
    expect(spies.updateMessageContent).not.toHaveBeenCalled()
  })

  it('surfaces errors to the placeholder and updates audio state', async () => {
    const streamError = new Error('network issue')
    const { handler, spies } = setupHandler({
      createOpenAIResponseImpl: vi.fn().mockRejectedValue(streamError),
    })

    await handler.handleToolCalls({
      toolCalls: [createToolCall()],
      originalResponseIdForTool: 'resp_1',
    })

    expect(spies.parseErrorMessage).toHaveBeenCalledWith(streamError)
    expect(spies.updateMessageContent).toHaveBeenCalledWith('placeholder', [
      { type: 'app_error', text: 'error' },
    ])
    expect(spies.setAudioState).toHaveBeenCalledWith('IDLE')
  })

  it('respects recording state when selecting error audio state', async () => {
    const streamError = new Error('network issue')
    const { handler, spies } = setupHandler({
      isRecordingRequested: true,
      createOpenAIResponseImpl: vi.fn().mockRejectedValue(streamError),
    })

    await handler.handleToolCalls({
      toolCalls: [createToolCall()],
      originalResponseIdForTool: 'resp_1',
    })

    expect(spies.setAudioState).toHaveBeenCalledWith('LISTENING')
  })

  it('ignores AbortError from continuation attempts', async () => {
    const abortError = Object.assign(new Error('cancelled'), {
      name: 'AbortError',
    })
    const { handler, spies } = setupHandler({
      createOpenAIResponseImpl: vi.fn().mockRejectedValue(abortError),
    })

    await handler.handleToolCalls({
      toolCalls: [createToolCall()],
      originalResponseIdForTool: 'resp_1',
    })

    expect(spies.logError).not.toHaveBeenCalledWith(
      'Error in continued stream after tool call:',
      abortError
    )
    expect(spies.updateMessageContent).not.toHaveBeenCalled()
    expect(spies.setAudioState).not.toHaveBeenCalled()
  })
})
