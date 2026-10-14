import { afterEach, describe, expect, it } from 'vitest'
import { BackgroundProcessManager } from '../../electron/main/backgroundProcessManager'

const managers: BackgroundProcessManager[] = []

afterEach(() => {
  for (const manager of managers) manager.dispose()
  managers.length = 0
})

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 3_000
): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('Timed out waiting for process.')
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

describe('BackgroundProcessManager', () => {
  it('starts, polls, and retains completed process output', async () => {
    const manager = new BackgroundProcessManager()
    managers.push(manager)
    const command = `${JSON.stringify(process.execPath)} -e "process.stdout.write('ready')"`
    const started = manager.start(command)
    expect(started.processId).toMatch(/^proc-/)
    await waitFor(() => manager.output(started.processId).status !== 'running')
    const output = manager.output(started.processId)
    expect(output.status).toBe('completed')
    expect(output.output).toBe('ready')
    expect(output.cursor).toBe(5)
    expect(manager.output(started.processId, output.cursor).output).toBe('')
  })

  it('writes stdin, stops a process tree, and rejects forged IDs', async () => {
    const manager = new BackgroundProcessManager()
    managers.push(manager)
    const script = "process.stdin.once('data',d=>process.stdout.write(d));setInterval(()=>{},1000)"
    const started = manager.start(
      `${JSON.stringify(process.execPath)} -e ${JSON.stringify(script)}`
    )
    manager.write(started.processId, 'hello')
    await waitFor(() => manager.output(started.processId).output.includes('hello'))
    expect(manager.stop(started.processId).status).toBe('stopped')
    expect(() => manager.output('proc-forged')).toThrow('Unknown or expired')
  })

  it('limits concurrent processes', () => {
    const manager = new BackgroundProcessManager()
    managers.push(manager)
    const command = `${JSON.stringify(process.execPath)} -e "setInterval(()=>{},1000)"`
    for (let index = 0; index < 5; index += 1) manager.start(command)
    expect(() => manager.start(command)).toThrow('At most 5')
  })
})
