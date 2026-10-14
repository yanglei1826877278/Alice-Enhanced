import { describe, expect, it } from 'vitest'
import {
  isAllowedEventChannel,
  isAllowedInvokeChannel,
  isAllowedSendChannel,
} from '../../electron/preload/ipcBridgePolicy'

describe('renderer IPC bridge policy', () => {
  it('allows only known renderer invoke and send channels', () => {
    expect(isAllowedInvokeChannel('memory:get')).toBe(true)
    expect(isAllowedInvokeChannel('image:describe-for-memory')).toBe(true)
    expect(isAllowedInvokeChannel('unknown:channel')).toBe(false)
    expect(isAllowedInvokeChannel('desktop:listDirectory')).toBe(true)
    expect(isAllowedInvokeChannel('desktop:executeCommand')).toBe(true)
    expect(isAllowedInvokeChannel('desktop:readFile')).toBe(true)
    expect(isAllowedInvokeChannel('desktop:viewImage')).toBe(true)
    expect(isAllowedInvokeChannel('desktop:webFetch')).toBe(true)
    expect(isAllowedInvokeChannel('desktop:process')).toBe(true)
    expect(isAllowedInvokeChannel('desktop:writeTextFile')).toBe(true)
    expect(isAllowedInvokeChannel('desktop:searchFiles')).toBe(true)
    expect(isAllowedInvokeChannel('permissions:get')).toBe(true)
    expect(isAllowedInvokeChannel('permissions:set-mode')).toBe(true)
    expect(isAllowedInvokeChannel('permissions:remove-rule')).toBe(true)
    expect(isAllowedInvokeChannel('permissions:clear-session')).toBe(true)
    expect(isAllowedInvokeChannel('storage:get')).toBe(true)
    expect(isAllowedInvokeChannel('storage:open-logs-root')).toBe(true)
    expect(isAllowedInvokeChannel('storage:choose-data-root')).toBe(true)
    expect(isAllowedInvokeChannel('storage:clear-legacy-cache')).toBe(true)
    expect(isAllowedInvokeChannel('codex-delegate:start')).toBe(true)
    expect(isAllowedInvokeChannel('codex-delegate:manage')).toBe(true)
    expect(isAllowedEventChannel('agent:status')).toBe(true)
    expect(isAllowedInvokeChannel('custom-avatars:set-chat-avatar')).toBe(true)
    expect(isAllowedInvokeChannel('skills:scan-user')).toBe(true)
    expect(isAllowedInvokeChannel('conversations:list')).toBe(true)
    expect(isAllowedInvokeChannel('conversations:get')).toBe(true)
    expect(isAllowedInvokeChannel('conversations:save')).toBe(true)
    expect(isAllowedInvokeChannel('conversations:rename')).toBe(true)
    expect(isAllowedInvokeChannel('conversations:delete')).toBe(true)
    expect(isAllowedSendChannel('restart-and-install-update')).toBe(true)
    expect(isAllowedSendChannel('desktop:executeCommand')).toBe(false)
  })

  it('allows stream event ids without allowing arbitrary event channels', () => {
    expect(isAllowedEventChannel('codex:stream:event:request-123')).toBe(true)
    expect(
      isAllowedEventChannel('http:stream:event:renderer-http-stream-1-a_b')
    ).toBe(true)
    expect(isAllowedEventChannel('http:stream:event:../../settings:load')).toBe(
      false
    )
    expect(isAllowedEventChannel('unknown:event')).toBe(false)
    expect(isAllowedEventChannel('custom-avatars:updated')).toBe(true)
  })
})
