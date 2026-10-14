import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'

const MAX_PROCESSES = 5
const MAX_OUTPUT_CHARS = 256_000
const IDLE_TTL_MS = 30 * 60_000
const FINISHED_TTL_MS = 10 * 60_000

export interface ManagedProcessSnapshot {
  processId: string
  status: 'running' | 'completed' | 'failed' | 'stopped'
  startedAt: string
  finishedAt?: string
  exitCode?: number | null
  signal?: string | null
}

interface ManagedProcess extends ManagedProcessSnapshot {
  command: string
  child: ChildProcessWithoutNullStreams
  output: string
  outputOffset: number
  lastAccessedAt: number
}

export class BackgroundProcessManager {
  private readonly processes = new Map<string, ManagedProcess>()
  private readonly cleanupTimer = setInterval(() => this.cleanup(), 60_000)

  constructor() {
    this.cleanupTimer.unref()
  }

  start(command: string, cwd?: string): ManagedProcessSnapshot {
    this.cleanup()
    const runningCount = [...this.processes.values()].filter(
      entry => entry.status === 'running'
    ).length
    if (runningCount >= MAX_PROCESSES) {
      throw new Error(`At most ${MAX_PROCESSES} background processes may run.`)
    }

    const processId = `proc-${randomUUID()}`
    const child = spawn(command, [], {
      cwd,
      shell: true,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const entry: ManagedProcess = {
      processId,
      status: 'running',
      command,
      startedAt: new Date().toISOString(),
      child,
      output: '',
      outputOffset: 0,
      lastAccessedAt: Date.now(),
    }
    this.processes.set(processId, entry)

    const append = (chunk: Buffer) => {
      entry.output += chunk.toString('utf8')
      if (entry.output.length > MAX_OUTPUT_CHARS) {
        const removed = entry.output.length - MAX_OUTPUT_CHARS
        entry.output = entry.output.slice(removed)
        entry.outputOffset += removed
      }
    }
    child.stdout.on('data', append)
    child.stderr.on('data', append)
    child.once('error', error => {
      append(Buffer.from(`\n[process error] ${error.message}\n`))
      entry.status = 'failed'
      entry.finishedAt = new Date().toISOString()
    })
    child.once('exit', (code, signal) => {
      if (entry.status === 'running') {
        entry.status = code === 0 ? 'completed' : 'failed'
      }
      entry.exitCode = code
      entry.signal = signal
      entry.finishedAt = new Date().toISOString()
      entry.lastAccessedAt = Date.now()
    })

    return this.snapshot(entry)
  }

  list(): ManagedProcessSnapshot[] {
    this.cleanup()
    return [...this.processes.values()].map(entry => this.snapshot(entry))
  }

  output(processId: string, cursor = 0): ManagedProcessSnapshot & {
    output: string
    cursor: number
    truncated: boolean
  } {
    const entry = this.requireProcess(processId)
    entry.lastAccessedAt = Date.now()
    const safeCursor = Number.isFinite(cursor) ? Math.max(0, cursor) : 0
    const truncated = safeCursor < entry.outputOffset
    const start = Math.max(0, safeCursor - entry.outputOffset)
    return {
      ...this.snapshot(entry),
      output: entry.output.slice(start),
      cursor: entry.outputOffset + entry.output.length,
      truncated,
    }
  }

  write(processId: string, input: string): ManagedProcessSnapshot {
    const entry = this.requireProcess(processId)
    if (entry.status !== 'running' || !entry.child.stdin.writable) {
      throw new Error('The background process is not accepting input.')
    }
    if (input.length > 64_000) throw new Error('Process input is too large.')
    entry.child.stdin.write(input)
    entry.lastAccessedAt = Date.now()
    return this.snapshot(entry)
  }

  stop(processId: string): ManagedProcessSnapshot {
    const entry = this.requireProcess(processId)
    if (entry.status === 'running') {
      entry.status = 'stopped'
      entry.finishedAt = new Date().toISOString()
      this.terminate(entry)
    }
    entry.lastAccessedAt = Date.now()
    return this.snapshot(entry)
  }

  dispose(): void {
    clearInterval(this.cleanupTimer)
    for (const entry of this.processes.values()) {
      if (entry.status === 'running') this.terminate(entry)
    }
    this.processes.clear()
  }

  private requireProcess(processId: string): ManagedProcess {
    this.cleanup()
    const entry = this.processes.get(processId)
    if (!entry) throw new Error('Unknown or expired background process ID.')
    return entry
  }

  private cleanup(): void {
    const now = Date.now()
    for (const [id, entry] of this.processes) {
      const ttl = entry.status === 'running' ? IDLE_TTL_MS : FINISHED_TTL_MS
      if (now - entry.lastAccessedAt < ttl) continue
      if (entry.status === 'running') this.terminate(entry)
      this.processes.delete(id)
    }
  }

  private snapshot(entry: ManagedProcess): ManagedProcessSnapshot {
    return {
      processId: entry.processId,
      status: entry.status,
      startedAt: entry.startedAt,
      finishedAt: entry.finishedAt,
      exitCode: entry.exitCode,
      signal: entry.signal,
    }
  }

  private terminate(entry: ManagedProcess): void {
    const pid = entry.child.pid
    if (!pid || !Number.isSafeInteger(pid) || pid <= 0) return
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(pid), '/t', '/f'], {
        windowsHide: true,
        stdio: 'ignore',
      })
      return
    }
    try {
      process.kill(-pid, 'SIGTERM')
    } catch {
      entry.child.kill('SIGTERM')
    }
  }
}
