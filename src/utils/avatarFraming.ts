import type { CSSProperties } from 'vue'

export interface AvatarFraming {
  x: number
  y: number
  scale: number
}
export type AvatarVideoState = 'standby' | 'thinking' | 'speaking'
export const DEFAULT_AVATAR_FRAMING: AvatarFraming = { x: 0, y: 0, scale: 1 }
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value))

export function getAvatarFraming(
  raw: string,
  avatarId: string,
  state: AvatarVideoState = 'standby'
): AvatarFraming {
  try {
    const frames = JSON.parse(raw || '{}')
    // Older settings stored one crop per avatar. Keep using that crop for any
    // state that has not been adjusted individually yet.
    const value = frames[`${avatarId}/${state}`] || frames[avatarId]
    return {
      x: Number.isFinite(value?.x) ? clamp(value.x, -1, 1) : 0,
      y: Number.isFinite(value?.y) ? clamp(value.y, -1, 1) : 0,
      scale: Number.isFinite(value?.scale) ? clamp(value.scale, 1, 3) : 1,
    }
  } catch {
    return { ...DEFAULT_AVATAR_FRAMING }
  }
}

export function setAvatarFraming(
  raw: string,
  avatarId: string,
  frame: AvatarFraming,
  state: AvatarVideoState = 'standby'
): string {
  let frames: Record<string, AvatarFraming> = {}
  try {
    frames = JSON.parse(raw || '{}')
    if (!frames || Array.isArray(frames) || typeof frames !== 'object')
      frames = {}
  } catch {}
  return JSON.stringify({ ...frames, [`${avatarId}/${state}`]: frame })
}

export function getAvatarVideoState(audioState: string): AvatarVideoState {
  if (audioState === 'SPEAKING') return 'speaking'
  if (
    audioState === 'PROCESSING_AUDIO' ||
    audioState === 'WAITING_FOR_RESPONSE' ||
    audioState === 'GENERATING_IMAGE'
  ) return 'thinking'
  return 'standby'
}

export function avatarFrameDimensions(frame: AvatarFraming, aspect: number) {
  const ratio = Number.isFinite(aspect) && aspect > 0 ? aspect : 1
  return {
    width: Math.max(1, ratio) * frame.scale,
    height: Math.max(1, 1 / ratio) * frame.scale,
  }
}

export function avatarFramingStyle(
  frame: AvatarFraming,
  aspect: number
): CSSProperties {
  const { width, height } = avatarFrameDimensions(frame, aspect)
  return {
    position: 'absolute',
    width: `${width * 100}%`,
    height: `${height * 100}%`,
    left: `${50 + frame.x * (width - 1) * 50}%`,
    top: `${50 + frame.y * (height - 1) * 50}%`,
    transform: 'translate(-50%, -50%)',
    objectFit: 'cover',
    maxWidth: 'none',
    borderRadius: '0',
  }
}
