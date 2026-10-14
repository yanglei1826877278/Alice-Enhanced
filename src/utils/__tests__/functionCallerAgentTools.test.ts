import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { executeFunction } from '../functionCaller'

describe('agent tool function registry', () => {
  const calls: string[] = []

  beforeEach(() => {
    calls.length = 0
    ;(globalThis as any).window = {
      desktopAPI: {
        readFile: vi.fn(async () => ({ success: true, data: { text: 'file' } })),
        viewImage: vi.fn(async () => ({
          success: true,
          data: {
            type: 'image',
            path: '/project/a.png',
            mimeType: 'image/png',
            size: 8,
            imageUrl: 'data:image/png;base64,iVBORw0KGgo=',
          },
        })),
        webFetch: vi.fn(async () => ({ success: true, data: { text: 'web' } })),
        process: vi.fn(async () => ({ success: true, data: { status: 'running' } })),
        delegateTask: vi.fn(async () => ({ success: true, data: { taskId: 'task-1' } })),
        manageDelegatedTask: vi.fn(async () => ({ success: true, data: { status: 'completed' } })),
        writeTextFile: vi.fn(async () => ({ success: true, data: { mode: 'create' } })),
        searchFiles: vi.fn(async () => ({ success: true, data: { results: ['a.txt'] } })),
      },
    }
  })

  afterEach(() => {
    delete (globalThis as any).window
  })

  it.each([
    ['read_file', { path: '/project/a.txt' }, 'file'],
    ['view_image', { path: '/project/a.png' }, 'data:image/png'],
    ['web_fetch', { url: 'https://example.com' }, 'web'],
    ['process', { action: 'list' }, 'running'],
    ['delegate_task', { prompt: 'review', cwd: '/project' }, 'task-1'],
    ['manage_delegated_task', { action: 'status', taskId: 'task-1' }, 'completed'],
    ['write_text_file', { path: '/project/a.txt', content: 'x', mode: 'create' }, 'create'],
    ['search_files', { root: '/project', pattern: '*.txt' }, 'a.txt'],
  ])('executes registered tool %s', async (name, args, expected) => {
    await expect(executeFunction(name, args)).resolves.toContain(expected)
  })

  it('applies required argument validation', async () => {
    await expect(executeFunction('read_file', {})).resolves.toContain(
      "Missing required parameter 'path'"
    )
    await expect(executeFunction('view_image', {})).resolves.toContain(
      "Missing required parameter 'path'"
    )
    await expect(executeFunction('delegate_task', { prompt: 'x' })).resolves.toContain(
      "Missing required parameter 'cwd'"
    )
  })
})
