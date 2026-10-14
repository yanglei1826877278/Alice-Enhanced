import { describe, expect, it } from 'vitest'
import { consumeCapturedVoiceDraft, composeVoiceRequest } from '../voiceDraft'

describe('voice draft composition', () => {
  it('combines a spoken request with typed supplemental context', () => {
    expect(
      composeVoiceRequest('帮我检查这个项目', '  C:\\Projects\\demo  ')
    ).toBe('帮我检查这个项目\n\n输入框补充：\nC:\\Projects\\demo')
  })

  it('keeps the spoken request unchanged when the draft is empty', () => {
    expect(composeVoiceRequest('  继续分析  ', '   ')).toBe('继续分析')
  })

  it('consumes the sent snapshot while preserving later edits', () => {
    expect(consumeCapturedVoiceDraft('path-a', 'path-a')).toBe('')
    expect(consumeCapturedVoiceDraft('path-a plus new text', 'path-a')).toBe(
      'plus new text'
    )
    expect(consumeCapturedVoiceDraft('edited path', 'path-a')).toBe(
      'edited path'
    )
    expect(consumeCapturedVoiceDraft('', '')).toBe('')
  })
})
