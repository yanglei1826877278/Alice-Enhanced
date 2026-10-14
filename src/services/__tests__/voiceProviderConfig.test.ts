import { describe, expect, it } from 'vitest'
import {
  getCloudVoiceSettings,
  normalizeDoubaoSpeechRate,
} from '../voiceProviderConfig'

describe('Doubao speech rate settings', () => {
  it.each([
    [-80, -50],
    [-25.6, -26],
    [20, 20],
    [140, 100],
    ['35', 35],
    ['invalid', 0],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeDoubaoSpeechRate(input)).toBe(expected)
  })

  it('uses the normal speech rate when no value was saved', () => {
    expect(getCloudVoiceSettings({}).doubaoTtsSpeechRate).toBe(0)
  })
})
