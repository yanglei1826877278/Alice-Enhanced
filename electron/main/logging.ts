import { app } from 'electron'
import log from 'electron-log'
import fs from 'node:fs'
import path from 'node:path'

const MAX_LOG_FILE_BYTES = 5 * 1024 * 1024
const SENSITIVE_KEY =
  /(?:api[-_]?key|authorization|cookie|password|secret|token)/i
const SENSITIVE_TEXT =
  /((?:api[-_]?key|authorization|cookie|password|secret|token)["']?\s*[:=]\s*["']?)([^\s,"'}]+)/gi

let initialized = false

function sanitizeText(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(SENSITIVE_TEXT, '$1[REDACTED]')
}

function sanitizeLogValue(
  value: unknown,
  seen = new WeakSet<object>(),
  depth = 0
): unknown {
  if (typeof value === 'string') return sanitizeText(value)
  if (value === null || typeof value !== 'object') return value
  if (value instanceof Error) {
    return sanitizeText(value.stack || `${value.name}: ${value.message}`)
  }
  if (Buffer.isBuffer(value)) return `[Buffer ${value.length} bytes]`
  if (value instanceof Date) return value
  if (depth >= 6) return '[Object]'
  if (seen.has(value)) return '[Circular]'
  seen.add(value)

  if (Array.isArray(value)) {
    return value.map(item => sanitizeLogValue(item, seen, depth + 1))
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      SENSITIVE_KEY.test(key)
        ? '[REDACTED]'
        : sanitizeLogValue(nested, seen, depth + 1),
    ])
  )
}

export function getLogsRoot(): string {
  return path.join(app.getPath('userData'), 'logs')
}

export function initializeLogging(): void {
  if (initialized) return
  initialized = true

  const logsRoot = getLogsRoot()
  fs.mkdirSync(logsRoot, { recursive: true })
  log.transports.file.level = 'info'
  log.transports.file.maxSize = MAX_LOG_FILE_BYTES
  log.transports.file.resolvePathFn = () => path.join(logsRoot, 'main.log')
  log.hooks.push(message => ({
    ...message,
    data: message.data.map(value => sanitizeLogValue(value)),
  }))

  // Keep terminal output during development while making every existing
  // console call in the main process persist to the rotating log file.
  Object.assign(console, log.functions)
  log.initialize({ preload: false, spyRendererConsole: true })

  app.on('web-contents-created', (_event, contents) => {
    contents.on('render-process-gone', (_goneEvent, details) => {
      log.error('[Renderer] Process terminated:', details)
    })
    contents.on('preload-error', (_preloadEvent, preloadPath, error) => {
      log.error('[Renderer] Preload failed:', preloadPath, error)
    })
  })
  app.on('child-process-gone', (_event, details) => {
    log.error('[Electron] Child process terminated:', details)
  })

  log.info('[Logging] File logging initialized:', {
    logFile: path.join(logsRoot, 'main.log'),
    maxFileBytes: MAX_LOG_FILE_BYTES,
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    platform: `${process.platform} ${process.arch}`,
  })
}

export default log
