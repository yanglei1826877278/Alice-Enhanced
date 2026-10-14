import type OpenAI from 'openai'
import { useSettingsStore } from '../../stores/settingsStore'
import { getCustomClient } from '../apiClients'
import { createOpenAICompatibleResponse } from './openAICompatible'
import { createProviderModel, listModelsViaMainProcess } from './modelDiscovery'
import { streamViaMainProcess } from './mainProcessStream'

export function normalizeCustomBaseUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new Error('Enter a valid Base URL, such as https://example.com/v1.')
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'Base URL must use HTTP or HTTPS without credentials, query parameters, or fragments.'
    )
  }
  if (/\/(chat\/completions|responses|models)\/?$/.test(url.pathname)) {
    throw new Error(
      'Enter the API base path (such as /v1), without /chat/completions, /responses, or /models.'
    )
  }
  return url.toString().replace(/\/+$/, '')
}

export function listCustomModelsForConfig(apiKey: string, baseURL: string) {
  return listModelsViaMainProcess({
    apiKey: apiKey.trim(),
    baseURL: normalizeCustomBaseUrl(baseURL),
    providerName: 'Custom',
  })
}

export async function listCustomModels(): Promise<OpenAI.Models.Model[]> {
  const settings = useSettingsStore().config
  try {
    return await listCustomModelsForConfig(
      settings.VITE_CUSTOM_API_KEY,
      settings.customBaseUrl
    )
  } catch (error) {
    // Some compatible APIs expose chat completions without a model catalogue.
    if (!settings.assistantModel?.trim()) throw error
    return [
      ...new Set(
        [settings.assistantModel, settings.SUMMARIZATION_MODEL].filter(model =>
          model?.trim()
        )
      ),
    ].map(model => createProviderModel(model.trim(), 'custom'))
  }
}

export async function createCustomChatCompletionForConfig(
  apiKey: string,
  baseURL: string,
  params: OpenAI.Chat.ChatCompletionCreateParams,
  signal?: AbortSignal
): Promise<any> {
  if (!apiKey.trim()) throw new Error('Custom API Key is required.')
  if (signal?.aborted)
    throw new DOMException('The operation was aborted.', 'AbortError')
  const request = {
    url: `${normalizeCustomBaseUrl(baseURL)}/chat/completions`,
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey.trim()}`,
      'Content-Type': 'application/json',
    },
    data: params,
    timeout: 120 * 1000,
  }
  if (params.stream) return streamViaMainProcess(request, signal)
  if (typeof window === 'undefined' || !window.httpAPI)
    throw new Error('Electron HTTP bridge is unavailable.')
  const response = await window.httpAPI.request(request)
  if (!response.success || (response.status && response.status >= 400)) {
    throw new Error(
      response.response?.data?.error?.message ||
        response.data?.error?.message ||
        response.error ||
        `Custom API request failed (${response.response?.status || response.status || 'unknown status'}).`
    )
  }
  if (!Array.isArray(response.data?.choices) || !response.data.choices.length) {
    throw new Error(
      'The endpoint did not return an OpenAI-compatible chat completion.'
    )
  }
  return response.data
}

export function testCustomConnection(
  apiKey: string,
  baseURL: string,
  model: string
) {
  if (!model.trim())
    throw new Error('Enter an assistant model ID before testing.')
  return createCustomChatCompletionForConfig(apiKey, baseURL, {
    model: model.trim(),
    messages: [{ role: 'user', content: 'Reply with OK only.' }],
    stream: false,
  })
}

export function createCustomResponse(
  input: OpenAI.Responses.Request.InputItemLike[],
  _previousResponseId: string | null,
  stream = false,
  customInstructions?: string,
  signal?: AbortSignal
) {
  return createOpenAICompatibleResponse(
    'custom',
    getCustomClient,
    input,
    stream,
    customInstructions,
    signal
  )
}
