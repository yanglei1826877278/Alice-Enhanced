export type STTProvider =
  'openai' | 'groq' | 'google' | 'local' | 'doubao' | 'tencent' | 'custom'
export type TTSProvider =
  'openai' | 'google' | 'local' | 'doubao' | 'tencent' | 'custom'

export interface CloudVoiceSettings {
  VITE_DOUBAO_SPEECH_API_KEY: string
  VITE_TENCENT_SECRET_ID: string
  VITE_TENCENT_SECRET_KEY: string
  VITE_CUSTOM_SPEECH_API_KEY: string
  doubaoTtsResourceId: string
  doubaoTtsVoice: string
  doubaoTtsSpeechRate: number
  tencentSttEngine: string
  tencentTtsVoice: string
  customSpeechBaseUrl: string
  customSttModel: string
  customTtsModel: string
  customTtsVoice: string
}

export const DEFAULT_CLOUD_VOICE_SETTINGS: CloudVoiceSettings = {
  VITE_DOUBAO_SPEECH_API_KEY: '',
  VITE_TENCENT_SECRET_ID: '',
  VITE_TENCENT_SECRET_KEY: '',
  VITE_CUSTOM_SPEECH_API_KEY: '',
  doubaoTtsResourceId: 'seed-tts-2.0',
  doubaoTtsVoice: 'zh_female_vv_uranus_bigtts',
  doubaoTtsSpeechRate: 0,
  tencentSttEngine: '16k_zh',
  tencentTtsVoice: '1001',
  customSpeechBaseUrl: '',
  customSttModel: 'whisper-1',
  customTtsModel: 'tts-1',
  customTtsVoice: 'alloy',
}

export const CLOUD_VOICE_SETTING_LABELS: Record<
  keyof CloudVoiceSettings,
  string
> = {
  VITE_DOUBAO_SPEECH_API_KEY: 'Doubao Speech API Key',
  VITE_TENCENT_SECRET_ID: 'Tencent Cloud SecretId',
  VITE_TENCENT_SECRET_KEY: 'Tencent Cloud SecretKey',
  VITE_CUSTOM_SPEECH_API_KEY: 'Custom Speech API Key',
  doubaoTtsResourceId: 'Doubao TTS Resource ID',
  doubaoTtsVoice: 'Doubao TTS Voice ID',
  doubaoTtsSpeechRate: 'Doubao TTS Speech Rate',
  tencentSttEngine: 'Tencent ASR Engine',
  tencentTtsVoice: 'Tencent TTS Voice ID',
  customSpeechBaseUrl: 'Custom Speech Base URL',
  customSttModel: 'Custom Transcription Model',
  customTtsModel: 'Custom Speech Model',
  customTtsVoice: 'Custom Speech Voice',
}

export function getCloudVoiceSettings(
  source: Partial<CloudVoiceSettings>
): CloudVoiceSettings {
  const settings = Object.fromEntries(
    Object.entries(DEFAULT_CLOUD_VOICE_SETTINGS).map(([key, fallback]) => [
      key,
      source[key as keyof CloudVoiceSettings] ?? fallback,
    ])
  ) as unknown as CloudVoiceSettings
  settings.doubaoTtsSpeechRate = normalizeDoubaoSpeechRate(
    source.doubaoTtsSpeechRate
  )
  return settings
}

export function normalizeDoubaoSpeechRate(value: unknown): number {
  const rate = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(rate)) return 0
  return Math.min(100, Math.max(-50, Math.round(rate)))
}

export function getVoiceConfigurationError(
  config: Partial<CloudVoiceSettings> & {
    sttProvider: STTProvider
    ttsProvider: TTSProvider
    embeddingProvider: 'openai' | 'local' | 'aliyun'
    VITE_OPENAI_API_KEY?: string
    VITE_GROQ_API_KEY?: string
    VITE_GOOGLE_API_KEY?: string
  }
): string | null {
  const providers = [config.sttProvider, config.ttsProvider]
  if (
    (providers.includes('openai') || config.embeddingProvider === 'openai') &&
    !config.VITE_OPENAI_API_KEY?.trim()
  )
    return 'OpenAI API Key is required for the selected voice or embedding provider.'
  if (
    providers.includes('doubao') &&
    !config.VITE_DOUBAO_SPEECH_API_KEY?.trim()
  )
    return 'Doubao Speech API Key is required.'
  if (
    config.ttsProvider === 'doubao' &&
    (!config.doubaoTtsVoice?.trim() || !config.doubaoTtsResourceId?.trim())
  )
    return 'Doubao voice and resource IDs are required.'
  if (
    providers.includes('tencent') &&
    (!config.VITE_TENCENT_SECRET_ID?.trim() ||
      !config.VITE_TENCENT_SECRET_KEY?.trim())
  )
    return 'Tencent Cloud SecretId and SecretKey are required.'
  if (config.sttProvider === 'tencent' && !config.tencentSttEngine?.trim())
    return 'Tencent ASR engine is required.'
  if (
    config.ttsProvider === 'tencent' &&
    !/^\d+$/.test(config.tencentTtsVoice?.trim() || '')
  )
    return 'Tencent TTS Voice ID must be a non-negative integer.'
  if (providers.includes('custom')) {
    if (!config.VITE_CUSTOM_SPEECH_API_KEY?.trim())
      return 'Custom Speech API Key is required.'
    try {
      const url = new URL(config.customSpeechBaseUrl?.trim() || '')
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        throw new Error()
    } catch {
      return 'Enter a valid custom speech Base URL using HTTP or HTTPS.'
    }
    if (config.sttProvider === 'custom' && !config.customSttModel?.trim())
      return 'Custom transcription model is required.'
    if (
      config.ttsProvider === 'custom' &&
      (!config.customTtsModel?.trim() || !config.customTtsVoice?.trim())
    )
      return 'Custom speech model and voice are required.'
  }
  if (config.sttProvider === 'groq' && !config.VITE_GROQ_API_KEY?.trim())
    return 'Groq API Key is required.'
  if (providers.includes('google') && !config.VITE_GOOGLE_API_KEY?.trim())
    return 'Google API Key is required.'
  return null
}

export function voiceProviderLabel(provider: string): string {
  return (
    (
      {
        openai: 'OpenAI',
        groq: 'Groq',
        google: 'Google',
        local: 'Local',
        doubao: '豆包语音 · Doubao',
        tencent: '腾讯云 · Tencent Cloud',
        custom: 'Custom (OpenAI-compatible)',
      } as Record<string, string>
    )[provider] || provider
  )
}
