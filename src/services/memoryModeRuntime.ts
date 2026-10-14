import type { MemoryMode } from '../stores/settingsStore'

let activeMemoryMode: MemoryMode = 'session'

export function setActiveMemoryMode(mode: MemoryMode): void {
  activeMemoryMode = mode
}

export function getActiveMemoryMode(): MemoryMode {
  return activeMemoryMode
}
