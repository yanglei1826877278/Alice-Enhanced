import { afterEach, describe, expect, it, vi } from 'vitest'
import { injectExplicitSkill } from '../skills'

afterEach(() => {
  delete (globalThis as any).window
})

describe('explicit skill invocation', () => {
  it('loads a skill before a user message beginning with $name', async () => {
    const activate = vi.fn().mockResolvedValue({
      success: true,
      data: {
        name: 'example-skill',
        content: '---\nname: example-skill\n---\nFollow steps.',
        directory: '/skills/example-skill',
      },
    })
    ;(globalThis as any).window = { skillsAPI: { activate } }
    const input = [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: '$example-skill summarize this' },
        ],
      },
    ] as any
    const result = await injectExplicitSkill(input)
    expect(result).toHaveLength(2)
    expect((result[0] as any).content[0].text).toContain('Follow steps.')
    expect(result[1]).toBe(input[0])
    expect(activate).toHaveBeenCalledWith('example-skill')
  })

  it('does not reload a skill during a tool continuation', async () => {
    const activate = vi.fn()
    ;(globalThis as any).window = { skillsAPI: { activate } }
    const input = [
      { role: 'user', content: '$example-skill do it' },
      { type: 'function_call_output', call_id: 'call_1', output: 'done' },
    ] as any
    expect(await injectExplicitSkill(input)).toBe(input)
    expect(activate).not.toHaveBeenCalled()
  })

  it('keeps a directly invoked skill in full-history provider requests', async () => {
    const activate = vi
      .fn()
      .mockResolvedValue({
        success: true,
        data: {
          name: 'example-skill',
          content: 'Follow steps.',
          directory: '/skills/example-skill',
        },
      })
    ;(globalThis as any).window = { skillsAPI: { activate } }
    const input = [
      { role: 'user', content: '$example-skill do it' },
      { type: 'function_call_output', call_id: 'call_1', output: 'done' },
    ] as any
    const result = await injectExplicitSkill(input, true)
    expect(result).toHaveLength(3)
    expect((result[0] as any).content[0].text).toContain('Follow steps.')
    expect(result[2]).toBe(input[1])
  })
})
