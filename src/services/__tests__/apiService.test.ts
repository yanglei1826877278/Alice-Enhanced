import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { transcribeWithGoogle } from '../apiService'
import { useSettingsStore } from '../../stores/settingsStore'
import { float32ArrayToWav } from '../../utils/audioProcess'

describe('transcribeWithGoogle', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useSettingsStore().updateSetting('VITE_GOOGLE_API_KEY', 'test-key')
  })

  it('rejects recordings longer than Google synchronous recognition allows', async () => {
    const overlongRecording = float32ArrayToWav(
      new Float32Array(16000 * 60 + 1),
      16000
    )

    await expect(transcribeWithGoogle(overlongRecording)).rejects.toThrow(
      'Google STT only supports recordings up to 60 seconds'
    )
  })
})
