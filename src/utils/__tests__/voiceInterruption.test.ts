import { describe, expect, it } from 'vitest'
import { isExplicitVoiceStopRequest } from '../voiceInterruption'

describe('voice interruption detection', () => {
  it.each(['停一下', '停止。', '取消！', '别改了', '先别改', '先听我说'])(
    'recognizes the explicit stop phrase %s',
    phrase => {
      expect(isExplicitVoiceStopRequest(phrase)).toBe(true)
    }
  )

  it('does not discard a longer steering instruction as a stop-only command', () => {
    expect(isExplicitVoiceStopRequest('停一下，把路径换成 D:\\work')).toBe(
      false
    )
  })
})
