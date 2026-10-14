import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AGENT_RUN_LIMITS,
  AgentRunGuard,
  TOOL_TIMEOUTS,
  canonicalizeToolArgs,
  classifyTool,
  withTimeout,
} from '../agentRunGuard'

afterEach(() => {
  vi.useRealTimers()
})

describe('AgentRunGuard', () => {
  it('canonicalizes nested arguments independently of key order', () => {
    expect(
      canonicalizeToolArgs({ z: 1, a: { y: 2, x: 3 } })
    ).toBe(canonicalizeToolArgs('{"a":{"x":3,"y":2},"z":1}'))
  })

  it('classifies built-in and conventionally named tools', () => {
    expect(classifyTool('get_current_datetime')).toBe('local')
    expect(classifyTool('list_directory')).toBe('filesystem')
    expect(classifyTool('execute_command')).toBe('shell')
    expect(classifyTool('perform_web_search')).toBe('network')
    expect(classifyTool('generate_image')).toBe('generation')
    expect(classifyTool('delegate_to_codex')).toBe('delegation')
    expect(classifyTool('read_file')).toBe('filesystem')
    expect(classifyTool('view_image')).toBe('filesystem')
    expect(classifyTool('write_text_file')).toBe('filesystem')
    expect(classifyTool('search_files')).toBe('filesystem')
    expect(classifyTool('web_fetch')).toBe('network')
    expect(classifyTool('process')).toBe('shell')
    expect(classifyTool('delegate_task')).toBe('delegation')
    expect(classifyTool('manage_delegated_task')).toBe('delegation')
  })

  it('allows ten model turns and resets for the next user run', () => {
    const guard = new AgentRunGuard()
    expect(guard.beginModelTurn(false)).toBe(true)
    for (let turn = 1; turn < AGENT_RUN_LIMITS.maxModelTurns; turn += 1) {
      expect(guard.beginModelTurn(true)).toBe(true)
    }
    expect(guard.canContinueWithModel()).toBe(false)
    expect(guard.beginModelTurn(true)).toBe(false)
    expect(guard.beginModelTurn(false)).toBe(true)
    expect(guard.canContinueWithModel()).toBe(true)
  })

  it('blocks calls after the total tool-call allowance', () => {
    const guard = new AgentRunGuard()
    guard.beginModelTurn(false)
    for (let call = 0; call < AGENT_RUN_LIMITS.maxToolCalls; call += 1) {
      expect(guard.prepareToolCall('custom_tool', { call }).allowed).toBe(true)
    }
    const blocked = guard.prepareToolCall('custom_tool', { call: 21 })
    expect(blocked.allowed).toBe(false)
    expect(blocked.error).toContain('20 tool call limit')
  })

  it('blocks a third equivalent call even when object key order changes', () => {
    const guard = new AgentRunGuard()
    guard.beginModelTurn(false)
    expect(guard.prepareToolCall('lookup', { a: 1, b: 2 }).allowed).toBe(true)
    expect(guard.prepareToolCall('lookup', { b: 2, a: 1 }).allowed).toBe(true)
    const blocked = guard.prepareToolCall('lookup', '{"b":2,"a":1}')
    expect(blocked.allowed).toBe(false)
    expect(blocked.error).toContain('already executed twice')
  })

  it('caps each tool timeout by its category and remaining run time', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const guard = new AgentRunGuard()
    guard.beginModelTurn(false)
    expect(guard.prepareToolCall('execute_command', { command: 'x' }).timeoutMs)
      .toBe(TOOL_TIMEOUTS.shell)

    vi.advanceTimersByTime(AGENT_RUN_LIMITS.maxRunDurationMs - 5_000)
    expect(guard.prepareToolCall('generate_image', { prompt: 'x' }).timeoutMs)
      .toBe(5_000)
    vi.advanceTimersByTime(5_000)
    expect(guard.isExpired()).toBe(true)
  })

  it('turns an overdue operation into a timeout error', async () => {
    vi.useFakeTimers()
    const pending = withTimeout(
      new Promise<string>(() => {}),
      10_000,
      'Tool slow_tool'
    )
    const assertion = expect(pending).rejects.toThrow(
      'timed out after 10000ms'
    )
    await vi.advanceTimersByTimeAsync(10_000)
    await assertion
  })
})
