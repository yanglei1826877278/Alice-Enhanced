import { afterEach, describe, expect, it, vi } from 'vitest'

const { config, streamRequest } = vi.hoisted(() => ({
  config: {
    VITE_CUSTOM_API_KEY: 'sk-test',
    customBaseUrl: 'https://gateway.example/v1',
    assistantModel: 'vendor/model',
    SUMMARIZATION_MODEL: 'vendor/summary',
  },
  streamRequest: vi.fn(),
}))
vi.mock('../../../stores/settingsStore', () => ({
  useSettingsStore: () => ({ config }),
}))
vi.mock('../../apiClients', () => ({ getCustomClient: vi.fn() }))
vi.mock('../openAICompatible', () => ({
  createOpenAICompatibleResponse: vi.fn(),
}))
vi.mock('../mainProcessStream', () => ({ streamViaMainProcess: streamRequest }))

import {
  createCustomChatCompletionForConfig,
  listCustomModels,
  listCustomModelsForConfig,
  normalizeCustomBaseUrl,
  testCustomConnection,
} from '../custom'
import {
  getSafeProviderModel,
  isChatCompletionsProvider,
} from '../providerCatalog'

describe('custom OpenAI-compatible provider', () => {
  afterEach(() => {
    vi.clearAllMocks()
    delete (globalThis as any).window
  })

  it('normalizes cloud and local API base paths without adding /v1', () => {
    expect(normalizeCustomBaseUrl(' https://gateway.example/api/v1/// ')).toBe(
      'https://gateway.example/api/v1'
    )
    expect(normalizeCustomBaseUrl('http://localhost:8000')).toBe(
      'http://localhost:8000'
    )
  })

  it.each([
    'invalid',
    'file:///tmp/api',
    'https://user:secret@example.com/v1',
    'https://example.com/v1?key=secret',
    'https://example.com/v1#fragment',
    'https://example.com/v1/chat/completions',
    'https://example.com/v1/models',
  ])('rejects invalid API base URLs: %s', value => {
    expect(() => normalizeCustomBaseUrl(value)).toThrow()
  })

  it('discovers models using the entered URL and key', async () => {
    const request = vi
      .fn()
      .mockResolvedValue({
        success: true,
        data: { data: [{ id: 'vendor/b' }, { id: 'vendor/a' }] },
      })
    ;(globalThis as any).window = { httpAPI: { request } }
    expect(
      (
        await listCustomModelsForConfig(
          ' sk-test ',
          'https://gateway.example/api/v1/'
        )
      ).map(model => model.id)
    ).toEqual(['vendor/a', 'vendor/b'])
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://gateway.example/api/v1/models',
        headers: { Authorization: 'Bearer sk-test' },
      })
    )
  })

  it('keeps manual model IDs when /models is unsupported', async () => {
    ;(globalThis as any).window = {
      httpAPI: {
        request: vi
          .fn()
          .mockResolvedValue({ success: false, response: { status: 404 } }),
      },
    }
    expect((await listCustomModels()).map(model => model.id)).toEqual([
      'vendor/model',
      'vendor/summary',
    ])
    expect(getSafeProviderModel('custom', ' vendor/model ')).toBe(
      'vendor/model'
    )
    expect(isChatCompletionsProvider('custom')).toBe(true)
  })

  it('tests chat access with the chosen model rather than requiring model discovery', async () => {
    const request = vi
      .fn()
      .mockResolvedValue({
        success: true,
        data: { choices: [{ message: { content: 'OK' } }] },
      })
    ;(globalThis as any).window = { httpAPI: { request } }
    await testCustomConnection(
      ' sk-test ',
      'https://gateway.example/v1/',
      ' vendor/model '
    )
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://gateway.example/v1/chat/completions',
        method: 'POST',
        headers: {
          Authorization: 'Bearer sk-test',
          'Content-Type': 'application/json',
        },
        data: expect.objectContaining({ model: 'vendor/model', stream: false }),
      })
    )
  })

  it('reports API errors and rejects successful responses with an incompatible body', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        success: false,
        response: { status: 401, data: { error: { message: 'Invalid key' } } },
      })
      .mockResolvedValueOnce({ success: true, data: { data: [] } })
    ;(globalThis as any).window = { httpAPI: { request } }
    await expect(
      testCustomConnection('sk-test', config.customBaseUrl, 'vendor/model')
    ).rejects.toThrow('Invalid key')
    await expect(
      testCustomConnection('sk-test', config.customBaseUrl, 'vendor/model')
    ).rejects.toThrow('OpenAI-compatible chat completion')
  })

  it('streams through the main process and passes the abort signal', async () => {
    const controller = new AbortController()
    const stream = { [Symbol.asyncIterator]: vi.fn() }
    streamRequest.mockReturnValueOnce(stream)
    const params = {
      model: 'vendor/model',
      messages: [],
      stream: true as const,
    }
    expect(
      await createCustomChatCompletionForConfig(
        'sk-test',
        config.customBaseUrl,
        params,
        controller.signal
      )
    ).toBe(stream)
    expect(streamRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        url: `${config.customBaseUrl}/chat/completions`,
        data: params,
      }),
      controller.signal
    )
    controller.abort()
    await expect(
      createCustomChatCompletionForConfig(
        'sk-test',
        config.customBaseUrl,
        params,
        controller.signal
      )
    ).rejects.toThrow('aborted')
  })
})
