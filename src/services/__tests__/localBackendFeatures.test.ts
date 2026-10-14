import { describe, expect, it } from 'vitest'
import {
  getRequiredBackendFeatures,
  hasEnabledBackendFeature,
  haveSameBackendFeatures,
} from '../localBackendFeatures'

describe('local backend feature selection', () => {
  it('keeps the backend disabled for cloud-only settings', () => {
    const features = getRequiredBackendFeatures({
      sttProvider: 'openai',
      ttsProvider: 'google',
      embeddingProvider: 'aliyun',
    })

    expect(features).toEqual({ stt: false, tts: false, embeddings: false })
    expect(hasEnabledBackendFeature(features)).toBe(false)
  })

  it('enables only components backed by a local provider', () => {
    const features = getRequiredBackendFeatures({
      sttProvider: 'local',
      ttsProvider: 'openai',
      embeddingProvider: 'local',
    })

    expect(features).toEqual({ stt: true, tts: false, embeddings: true })
    expect(hasEnabledBackendFeature(features)).toBe(true)
  })

  it('compares backend configurations by feature', () => {
    const features = { stt: true, tts: false, embeddings: false }
    expect(haveSameBackendFeatures(features, { ...features })).toBe(true)
    expect(
      haveSameBackendFeatures(features, {
        stt: true,
        tts: true,
        embeddings: false,
      })
    ).toBe(false)
  })
})
