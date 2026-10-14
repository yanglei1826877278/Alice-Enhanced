import { describe, expect, it } from 'vitest'
import type OpenAI from 'openai'
import {
  createApiInputBuilder,
  selectHistoryForContext,
} from '../apiInputBuilder'
import type {
  ApiInputBuilderDependencies,
  ConversationHistoryMessage,
} from '../apiInputBuilder'

function buildDependencies(
  overrides: Partial<ApiInputBuilderDependencies> & {
    history?: ConversationHistoryMessage[]
  } = {}
): ApiInputBuilderDependencies {
  const history = overrides.history ?? []
  return {
    getChatHistory: () => history,
    getMaxHistoryMessagesForApi: () => 50,
    getAiProvider: () => 'openai',
    ...overrides,
  }
}

describe('createApiInputBuilder', () => {
  it('converts chat history into OpenAI input items', async () => {
    const history: ConversationHistoryMessage[] = [
      {
        role: 'assistant',
        content: [{ type: 'app_text', text: 'Hello!' }],
        tool_calls: [{ type: 'function', id: 'call_1' }],
      },
      {
        role: 'user',
        local_id_temp: 'user-1',
        content: [{ type: 'app_text', text: 'Show me a cat' }],
      },
    ]

    const builder = createApiInputBuilder(
      buildDependencies({ history, getAiProvider: () => 'openrouter' })
    )
    const result = await builder.build({ isNewChain: true })

    expect(result).toHaveLength(2)

    const assistantItem = result.find(item => item.role === 'assistant')
    const userItem = result.find(item => item.role === 'user')

    expect(userItem).toMatchObject({
      role: 'user',
      content: [{ type: 'input_text', text: 'Show me a cat' }],
    })

    expect(assistantItem).toMatchObject({
      role: 'assistant',
      content: [{ type: 'output_text', text: 'Hello!' }],
      tool_calls: history[0].tool_calls,
    })
  })

  it('limits history by complete user turns instead of raw message items', async () => {
    const history: ConversationHistoryMessage[] = [
      { role: 'assistant', content: 'new answer' },
      { role: 'tool', tool_call_id: 'call_1', content: 'tool result' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'call_1', name: 'read_file', arguments: '{}' }],
      },
      { role: 'user', content: 'new question' },
      { role: 'assistant', content: 'old answer' },
      { role: 'user', content: 'old question' },
    ]

    const builder = createApiInputBuilder(
      buildDependencies({
        history,
        getMaxHistoryMessagesForApi: () => 1,
      })
    )

    const result = await builder.build({ isNewChain: false })
    expect(result).toHaveLength(4)
    expect(result.map((item: any) => item.role || item.type)).toEqual([
      'user',
      'assistant',
      'function_call_output',
      'assistant',
    ])
    expect(JSON.stringify(result)).not.toContain('old question')
  })

  it('uses a token budget while keeping recent turns contiguous', async () => {
    const history: ConversationHistoryMessage[] = [
      { role: 'assistant', content: 'current answer' },
      { role: 'user', content: 'current question' },
      { role: 'assistant', content: 'x'.repeat(400) },
      { role: 'user', content: 'large previous question' },
      { role: 'assistant', content: 'old answer' },
      { role: 'user', content: 'old question' },
    ]

    const builder = createApiInputBuilder(
      buildDependencies({
        history,
        getMaxHistoryMessagesForApi: () => 10,
      })
    )
    const result = await builder.build({ isNewChain: true })

    // The production budget is deliberately large; exercise the selector
    // directly below with a small deterministic budget.
    const selected = selectHistoryForContext(history, 10, 80)
    expect(selected.map(message => message.content)).toEqual([
      'current question',
      'current answer',
    ])
    expect(result.length).toBeGreaterThan(selected.length)
  })

  it('compacts old oversized tool results without changing the latest turn', async () => {
    const latestToolOutput = 'L'.repeat(5_000)
    const oldToolOutput = 'O'.repeat(5_000)
    const history: ConversationHistoryMessage[] = [
      { role: 'tool', tool_call_id: 'latest', content: latestToolOutput },
      { role: 'user', content: 'latest request' },
      { role: 'tool', tool_call_id: 'old', content: oldToolOutput },
      { role: 'user', content: 'old request' },
    ]
    const selected = selectHistoryForContext(history, 10, 20_000)
    const toolMessages = selected.filter(message => message.role === 'tool')

    expect(toolMessages[1].content).toBe(latestToolOutput)
    expect(String(toolMessages[0].content)).toContain(
      '[Older tool result truncated:'
    )
    expect(String(toolMessages[0].content).length).toBeLessThan(
      oldToolOutput.length
    )
  })

  it('maps tool responses into function_call_output items', async () => {
    const history: ConversationHistoryMessage[] = [
      { role: 'tool', tool_call_id: 'call_123', content: 'result' },
    ]

    const builder = createApiInputBuilder(buildDependencies({ history }))
    const result = await builder.build({ isNewChain: false })

    expect(result[0]).toMatchObject({
      type: 'function_call_output',
      call_id: 'call_123',
      output: 'result',
    })
  })

  it('keeps UI system status messages out of inference payloads', async () => {
    const history: ConversationHistoryMessage[] = [
      {
        role: 'tool',
        tool_call_id: 'call_123',
        content: '[]',
      },
      {
        role: 'system',
        content: [{ type: 'app_text', text: '🧠 Let me think back...' }],
      },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call_123',
            type: 'function',
            function: {
              name: 'recall_memories',
              arguments: '{"query":"cats"}',
            },
          },
        ],
      },
      {
        role: 'user',
        content: 'Do you remember my cats?',
      },
    ]

    const builder = createApiInputBuilder(
      buildDependencies({ history, getAiProvider: () => 'minimax' })
    )
    const result = await builder.build({ isNewChain: false })

    expect(result.some((item: any) => item.role === 'system')).toBe(false)
    expect(JSON.stringify(result)).not.toContain('Let me think back')
    expect(result.map((item: any) => item.role || item.type)).toEqual([
      'user',
      'assistant',
      'function_call_output',
    ])
  })

  it('preserves multiple images in the latest user message', async () => {
    const history: ConversationHistoryMessage[] = [
      {
        role: 'assistant',
        content: [{ type: 'app_text', text: 'Nice cat!' }],
      },
      {
        role: 'user',
        local_id_temp: 'user-last',
        content: [
          { type: 'app_text', text: 'Look at this' },
          { type: 'app_image_uri', uri: 'https://example.com/cat.png' },
          { type: 'app_image_uri', uri: 'https://example.com/dog.png' },
        ],
      },
    ]

    const builder = createApiInputBuilder(buildDependencies({ history }))
    const result = await builder.build({ isNewChain: false })
    const latestUserItem = result.find(item => item.role === 'user')

    expect(latestUserItem).toMatchObject({
      role: 'user',
      content: [
        { type: 'input_text', text: 'Look at this' },
        { type: 'input_image', image_url: 'https://example.com/cat.png' },
        { type: 'input_image', image_url: 'https://example.com/dog.png' },
      ],
    })
  })

  it('keeps the most recent image available for a text-only follow-up', async () => {
    const history: ConversationHistoryMessage[] = [
      {
        role: 'user',
        local_id_temp: 'user-follow-up',
        content: [{ type: 'app_text', text: '这是谁' }],
      },
      {
        role: 'assistant',
        content: [{ type: 'app_text', text: 'I cannot see an image.' }],
      },
      {
        role: 'user',
        local_id_temp: 'user-with-image',
        content: [
          { type: 'app_text', text: '看看这张图' },
          {
            type: 'app_image_uri',
            uri: 'data:image/png;base64,aW1hZ2U=',
          },
        ],
      },
    ]

    const builder = createApiInputBuilder(buildDependencies({ history }))
    const result = await builder.build({ isNewChain: false })
    const imageMessage = result.find((item: any) =>
      item.content?.some?.((part: any) => part.type === 'input_image')
    ) as any

    expect(imageMessage).toMatchObject({
      role: 'user',
      content: [
        { type: 'input_text', text: '看看这张图' },
        {
          type: 'input_image',
          image_url: 'data:image/png;base64,aW1hZ2U=',
        },
      ],
    })
  })

  it('uses placeholder text for images older than the most recent image', async () => {
    const history: ConversationHistoryMessage[] = [
      {
        role: 'user',
        local_id_temp: 'user-latest',
        content: [{ type: 'app_text', text: 'Most recent question' }],
      },
      {
        role: 'user',
        local_id_temp: 'user-recent-image',
        content: [
          { type: 'app_text', text: 'Most recent image' },
          { type: 'app_image_uri', uri: 'https://example.com/recent.png' },
        ],
      },
      {
        role: 'user',
        local_id_temp: 'user-old-image',
        content: [
          { type: 'app_text', text: 'Previously sent' },
          { type: 'app_image_uri', uri: 'https://example.com/old.png' },
        ],
      },
    ]

    const builder = createApiInputBuilder(buildDependencies({ history }))
    const result = await builder.build({ isNewChain: false })

    const placeholderItem = result.find(
      item =>
        item.role === 'user' &&
        Array.isArray(item.content) &&
        item.content.some(
          (part: any) =>
            part.type === 'input_text' &&
            part.text === '[User previously sent an image]'
        )
    ) as OpenAI.Responses.Request.UserContentBlock | undefined

    expect(placeholderItem?.content).toContainEqual({
      type: 'input_text',
      text: '[User previously sent an image]',
    })
  })
})
