import { ipcMain } from 'electron'
import { createHash, createHmac, randomUUID } from 'node:crypto'
import axios from 'axios'
import { transcribeWithDoubaoStreaming } from './doubaoAsr'
import { loadSettings, type AppSettings } from './settingsManager'
import { normalizeDoubaoSpeechRate } from '../../src/services/voiceProviderConfig'
import {
  getAllowedHttpOrigins,
  validateHttpBridgeUrl,
} from './securityBoundaries'

const activeRequests = new Map<string, AbortController>()
const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex')
const hmac = (key: string | Buffer, value: string) =>
  createHmac('sha256', key).update(value).digest()

function required(value: string | undefined, label: string): string {
  if (!value?.trim()) throw new Error(`${label} is required.`)
  return value.trim()
}

async function tencentRequest(
  settings: AppSettings,
  service: 'asr' | 'tts',
  action: string,
  version: string,
  body: object,
  signal: AbortSignal
) {
  const secretId = required(settings.VITE_TENCENT_SECRET_ID, 'Tencent SecretId')
  const secretKey = required(
    settings.VITE_TENCENT_SECRET_KEY,
    'Tencent SecretKey'
  )
  const host = `${service}.tencentcloudapi.com`
  const timestamp = Math.floor(Date.now() / 1000)
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10)
  const contentType = 'application/json; charset=utf-8'
  const payload = JSON.stringify(body)
  const signedHeaders = 'content-type;host'
  const canonicalRequest = `POST\n/\n\ncontent-type:${contentType}\nhost:${host}\n\n${signedHeaders}\n${sha256(payload)}`
  const scope = `${date}/${service}/tc3_request`
  const toSign = `TC3-HMAC-SHA256\n${timestamp}\n${scope}\n${sha256(canonicalRequest)}`
  const signingKey = hmac(
    hmac(hmac(`TC3${secretKey}`, date), service),
    'tc3_request'
  )
  const signature = hmac(signingKey, toSign).toString('hex')
  const response = await axios.post(`https://${host}/`, payload, {
    headers: {
      'Content-Type': contentType,
      Authorization: `TC3-HMAC-SHA256 Credential=${secretId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      'X-TC-Action': action,
      'X-TC-Version': version,
      'X-TC-Timestamp': String(timestamp),
    },
    signal,
    timeout: 120_000,
    maxRedirects: 0,
  })
  const data = response.data?.Response
  if (data?.Error)
    throw new Error(`Tencent ${data.Error.Code}: ${data.Error.Message}`)
  if (!data) throw new Error('Tencent returned an invalid response.')
  return data
}

function validateWav(audio: Buffer) {
  if (
    audio.length < 44 ||
    audio.toString('ascii', 0, 4) !== 'RIFF' ||
    audio.toString('ascii', 8, 12) !== 'WAVE'
  )
    throw new Error('Speech recognition requires a WAV recording.')
  let byteRate = 0
  let dataLength = 0
  for (let offset = 12; offset + 8 <= audio.length;) {
    const size = audio.readUInt32LE(offset + 4)
    if (offset + 8 + size > audio.length)
      throw new Error('The WAV recording is truncated.')
    const chunk = audio.toString('ascii', offset, offset + 4)
    if (chunk === 'fmt ' && size >= 16)
      byteRate = audio.readUInt32LE(offset + 16)
    if (chunk === 'data') dataLength += size
    offset += 8 + size + (size % 2)
  }
  if (!byteRate || !dataLength)
    throw new Error('The WAV recording has no audio data.')
  return dataLength / byteRate
}

async function transcribe(
  settings: AppSettings,
  audio: Buffer,
  signal: AbortSignal
): Promise<string> {
  const duration = validateWav(audio)
  if (settings.sttProvider === 'tencent') {
    if (duration > 60 || Math.ceil(audio.length / 3) * 4 > 3 * 1024 * 1024)
      throw new Error(
        'Tencent recognition supports recordings up to 60 seconds and 3 MB after Base64 encoding.'
      )
    const data = await tencentRequest(
      settings,
      'asr',
      'SentenceRecognition',
      '2019-06-14',
      {
        EngSerViceType: required(
          settings.tencentSttEngine,
          'Tencent ASR engine'
        ),
        SourceType: 1,
        VoiceFormat: 'wav',
        Data: audio.toString('base64'),
        DataLen: audio.length,
      },
      signal
    )
    if (typeof data.Result !== 'string')
      throw new Error('Tencent returned no transcription.')
    return data.Result
  }
  if (settings.sttProvider === 'doubao') {
    const apiKey = required(
      settings.VITE_DOUBAO_SPEECH_API_KEY,
      'Doubao Speech API Key'
    )
    return transcribeWithDoubaoStreaming(audio, apiKey, signal)
  }
  if (settings.sttProvider === 'custom') {
    const base = customBase(settings)
    const form = new FormData()
    form.append(
      'file',
      new Blob([new Uint8Array(audio)], { type: 'audio/wav' }),
      'audio.wav'
    )
    form.append(
      'model',
      required(settings.customSttModel, 'Transcription model')
    )
    form.append('response_format', 'json')
    const response = await axios.post(`${base}/audio/transcriptions`, form, {
      headers: {
        Authorization: `Bearer ${required(settings.VITE_CUSTOM_SPEECH_API_KEY, 'Speech API Key')}`,
      },
      signal,
      timeout: 120_000,
      maxRedirects: 0,
    })
    if (typeof response.data?.text !== 'string')
      throw new Error('The speech endpoint returned no transcription text.')
    return response.data.text
  }
  throw new Error('The selected provider does not use the cloud speech bridge.')
}

function customBase(settings: AppSettings): string {
  const base = required(
    settings.customSpeechBaseUrl,
    'Speech Base URL'
  ).replace(/\/+$/, '')
  validateHttpBridgeUrl(base, getAllowedHttpOrigins({ ...settings }))
  return base
}

async function synthesize(
  settings: AppSettings,
  text: string,
  signal: AbortSignal
): Promise<string> {
  if (settings.ttsProvider === 'tencent') {
    const voice = Number(
      required(settings.tencentTtsVoice, 'Tencent TTS Voice ID')
    )
    if (!Number.isSafeInteger(voice) || voice < 0)
      throw new Error('Tencent TTS Voice ID must be a non-negative integer.')
    const chunks: Buffer[] = []
    // Stay under the 150-character Chinese text limit, including mixed text.
    const characters = Array.from(text)
    for (let index = 0; index < characters.length; index += 120) {
      const data = await tencentRequest(
        settings,
        'tts',
        'TextToVoice',
        '2019-08-23',
        {
          Text: characters.slice(index, index + 120).join(''),
          SessionId: randomUUID(),
          ModelType: 1,
          VoiceType: voice,
          SampleRate: 16000,
          Codec: 'mp3',
        },
        signal
      )
      if (typeof data.Audio !== 'string' || !data.Audio)
        throw new Error('Tencent returned no synthesized audio.')
      chunks.push(Buffer.from(data.Audio, 'base64'))
    }
    return Buffer.concat(chunks).toString('base64')
  }
  if (settings.ttsProvider === 'doubao') {
    const response = await axios.post(
      'https://openspeech.bytedance.com/api/v3/tts/unidirectional',
      {
        user: { uid: 'alice' },
        req_params: {
          text,
          speaker: required(settings.doubaoTtsVoice, 'Doubao voice'),
          audio_params: {
            format: 'mp3',
            sample_rate: 24000,
            speech_rate: normalizeDoubaoSpeechRate(
              settings.doubaoTtsSpeechRate
            ),
          },
        },
      },
      {
        headers: {
          'X-Api-Key': required(
            settings.VITE_DOUBAO_SPEECH_API_KEY,
            'Doubao Speech API Key'
          ),
          'X-Api-Resource-Id': required(
            settings.doubaoTtsResourceId,
            'Doubao resource ID'
          ),
          'X-Api-Request-Id': randomUUID(),
          'Content-Type': 'application/json',
        },
        signal,
        timeout: 120_000,
        maxRedirects: 0,
        responseType: 'text',
      }
    )
    const chunks: Buffer[] = []
    for (const line of String(response.data)
      .split(/\r?\n/)
      .filter(line => line.trim())) {
      const part = JSON.parse(line)
      if (part.code !== undefined && ![0, 20000000].includes(Number(part.code)))
        throw new Error(
          `Doubao TTS ${part.code}: ${part.message || 'Synthesis failed.'}`
        )
      if (typeof part.data === 'string' && part.data)
        chunks.push(Buffer.from(part.data, 'base64'))
    }
    if (!chunks.length) throw new Error('Doubao returned no synthesized audio.')
    return Buffer.concat(chunks).toString('base64')
  }
  if (settings.ttsProvider === 'custom') {
    const response = await axios.post(
      `${customBase(settings)}/audio/speech`,
      {
        model: required(settings.customTtsModel, 'Speech model'),
        voice: required(settings.customTtsVoice, 'Speech voice'),
        input: text,
        response_format: 'mp3',
      },
      {
        headers: {
          Authorization: `Bearer ${required(settings.VITE_CUSTOM_SPEECH_API_KEY, 'Speech API Key')}`,
        },
        signal,
        timeout: 120_000,
        maxRedirects: 0,
        responseType: 'arraybuffer',
      }
    )
    const audio = Buffer.from(response.data)
    if (!audio.length)
      throw new Error('The speech endpoint returned empty audio.')
    return audio.toString('base64')
  }
  throw new Error('The selected provider does not use the cloud speech bridge.')
}

export function registerCloudVoiceHandlers(): void {
  ipcMain.handle(
    'voice:request',
    async (
      event,
      args: {
        requestId: string
        kind: 'stt' | 'tts'
        audio?: ArrayBuffer
        text?: string
      }
    ) => {
      if (
        !args ||
        typeof args.requestId !== 'string' ||
        !/^[A-Za-z0-9_-]{1,160}$/.test(args.requestId)
      )
        return { success: false, error: 'Invalid speech request.' }
      const key = `${event.sender.id}:${args.requestId}`
      if (activeRequests.has(key))
        return { success: false, error: 'Duplicate speech request.' }
      const controller = new AbortController()
      activeRequests.set(key, controller)
      const onDestroyed = () => controller.abort()
      event.sender.once('destroyed', onDestroyed)
      try {
        const settings = await loadSettings()
        if (!settings)
          throw new Error('Save your voice configuration before using speech.')
        if (args.kind === 'stt') {
          if (
            !(args.audio instanceof ArrayBuffer) ||
            args.audio.byteLength > 20 * 1024 * 1024
          )
            throw new Error('A WAV recording up to 20 MB is required.')
          return {
            success: true,
            text: await transcribe(
              settings,
              Buffer.from(args.audio),
              controller.signal
            ),
          }
        }
        if (
          args.kind !== 'tts' ||
          typeof args.text !== 'string' ||
          !args.text.trim() ||
          args.text.length > 10_000
        )
          throw new Error('Speech text must contain 1 to 10000 characters.')
        return {
          success: true,
          audio: await synthesize(settings, args.text, controller.signal),
          mimeType: 'audio/mpeg',
        }
      } catch (error: any) {
        // Never expose Axios request configs: they contain provider credentials.
        const providerError =
          error.response?.data?.error?.message || error.response?.data?.message
        return {
          success: false,
          error: controller.signal.aborted
            ? 'Speech request cancelled.'
            : providerError || error.message || 'Cloud speech request failed.',
        }
      } finally {
        event.sender.removeListener('destroyed', onDestroyed)
        activeRequests.delete(key)
      }
    }
  )
  ipcMain.handle('voice:cancel', (event, requestId: string) => {
    if (typeof requestId === 'string')
      activeRequests.get(`${event.sender.id}:${requestId}`)?.abort()
    return { success: true }
  })
}
