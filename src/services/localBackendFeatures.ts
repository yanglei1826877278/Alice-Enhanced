export interface BackendFeatures {
  stt: boolean
  tts: boolean
  embeddings: boolean
}

export interface LocalBackendSettings {
  sttProvider?: string
  ttsProvider?: string
  embeddingProvider?: string
}

export function getRequiredBackendFeatures(
  settings: LocalBackendSettings | null | undefined
): BackendFeatures {
  return {
    stt: settings?.sttProvider === 'local',
    tts: settings?.ttsProvider === 'local',
    embeddings: settings?.embeddingProvider === 'local',
  }
}

export function hasEnabledBackendFeature(features: BackendFeatures): boolean {
  return features.stt || features.tts || features.embeddings
}

export function haveSameBackendFeatures(
  left: BackendFeatures,
  right: BackendFeatures
): boolean {
  return (
    left.stt === right.stt &&
    left.tts === right.tts &&
    left.embeddings === right.embeddings
  )
}
