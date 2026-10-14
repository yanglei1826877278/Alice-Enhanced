import { describe, expect, it } from 'vitest'
import {
  getAvatarFraming,
  getAvatarVideoState,
  setAvatarFraming,
} from '../utils/avatarFraming'

describe('avatar framing by video state', () => {
  it('keeps an existing avatar crop until each video state is adjusted', () => {
    const legacy = JSON.stringify({
      'custom:demo-avatar': { x: 0.2, y: -0.1, scale: 1.4 },
    })
    const speaking = { x: -0.3, y: 0.2, scale: 1.7 }
    const saved = setAvatarFraming(
      legacy,
      'custom:demo-avatar',
      speaking,
      'speaking'
    )

    expect(getAvatarFraming(saved, 'custom:demo-avatar', 'speaking')).toEqual(
      speaking
    )
    expect(getAvatarFraming(saved, 'custom:demo-avatar', 'standby')).toEqual({
      x: 0.2,
      y: -0.1,
      scale: 1.4,
    })
    expect(getAvatarFraming(saved, 'custom:demo-avatar', 'thinking')).toEqual({
      x: 0.2,
      y: -0.1,
      scale: 1.4,
    })
  })

  it('uses the crop for the matching playback state', () => {
    expect(getAvatarVideoState('SPEAKING')).toBe('speaking')
    expect(getAvatarVideoState('WAITING_FOR_RESPONSE')).toBe('thinking')
    expect(getAvatarVideoState('IDLE')).toBe('standby')
  })
})
