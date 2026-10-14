import * as cron from 'node-cron'
import { randomUUID } from 'node:crypto'
import { getDBInstance } from './thoughtVectorStore'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { Notification, webContents } from 'electron'

const execAsync = promisify(exec)

export interface ScheduledTask {
  id: string
  name: string
  cronExpression?: string
  scheduleType?: 'recurring' | 'once'
  triggerAt?: string
  actionType: 'command' | 'reminder'
  details: string
  isActive: boolean
  createdAt: string
  lastRun?: string
  nextRun?: string
}

const activeCronJobs = new Map<string, cron.ScheduledTask>()
const activeOneShotTimers = new Map<string, NodeJS.Timeout>()
const MAX_TIMEOUT_DELAY_MS = 2_147_000_000

export function normalizeTriggerAt(
  triggerAt: string,
  nowMs = Date.now()
): { iso: string; localTimeZone: string } {
  const match =
    typeof triggerAt === 'string'
      ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|([+-])(\d{2}):(\d{2}))$/.exec(
          triggerAt
        )
      : null
  if (!match) {
    throw new Error(
      'triggerAt must be an ISO 8601 date-time with Z or an explicit offset.'
    )
  }
  const [, yearText, monthText, dayText, hourText, minuteText, secondText = '0'] =
    match
  const [year, month, day, hour, minute, second] = [
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
  ].map(Number)
  const calendarProbe = new Date(Date.UTC(year, month - 1, day, hour, minute, second))
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    calendarProbe.getUTCFullYear() !== year ||
    calendarProbe.getUTCMonth() !== month - 1 ||
    calendarProbe.getUTCDate() !== day
  ) {
    throw new Error('triggerAt is not a valid calendar date-time.')
  }
  if (match[8] !== 'Z') {
    const offsetHour = Number(match[10])
    const offsetMinute = Number(match[11])
    if (
      offsetHour > 14 ||
      offsetMinute > 59 ||
      (offsetHour === 14 && offsetMinute !== 0)
    ) {
      throw new Error('triggerAt has an invalid timezone offset.')
    }
  }
  const timestamp = Date.parse(triggerAt)
  if (!Number.isFinite(timestamp)) throw new Error('triggerAt is not a valid date-time.')
  if (timestamp <= nowMs) throw new Error('triggerAt must be in the future.')
  return {
    iso: new Date(timestamp).toISOString(),
    localTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }
}

/**
 * Initialize the scheduler database table
 */
export function initializeSchedulerDB(): void {
  const db = getDBInstance()

  db.exec(`
    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      cron_expression TEXT NOT NULL,
      action_type TEXT NOT NULL CHECK (action_type IN ('command', 'reminder')),
      details TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      last_run TEXT,
      next_run TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_active ON scheduled_tasks (is_active);
    CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_next_run ON scheduled_tasks (next_run);
  `)
  const columns = db.prepare('PRAGMA table_info(scheduled_tasks)').all() as Array<{
    name: string
  }>
  const columnNames = new Set(columns.map(column => column.name))
  if (!columnNames.has('schedule_type')) {
    db.exec("ALTER TABLE scheduled_tasks ADD COLUMN schedule_type TEXT NOT NULL DEFAULT 'recurring'")
  }
  if (!columnNames.has('trigger_at')) {
    db.exec('ALTER TABLE scheduled_tasks ADD COLUMN trigger_at TEXT')
  }

  console.log('[SchedulerManager] Database table initialized')
}

/**
 * Load all active tasks from database and schedule them
 */
export async function loadAndScheduleAllTasks(): Promise<void> {
  const db = getDBInstance()

  try {
    const activeTasks = db
      .prepare('SELECT * FROM scheduled_tasks WHERE is_active = 1')
      .all() as Array<{
      id: string
      name: string
      cron_expression: string
      action_type: string
      details: string
      is_active: number
      created_at: string
      last_run: string | null
      next_run: string | null
      schedule_type: string
      trigger_at: string | null
    }>

    console.log(`[SchedulerManager] Loading ${activeTasks.length} active tasks`)

    for (const task of activeTasks) {
      const scheduledTask: ScheduledTask = {
        id: task.id,
        name: task.name,
        cronExpression: task.cron_expression || undefined,
        scheduleType: task.schedule_type === 'once' ? 'once' : 'recurring',
        triggerAt: task.trigger_at || undefined,
        actionType: task.action_type as 'command' | 'reminder',
        details: task.details,
        isActive: task.is_active === 1,
        createdAt: task.created_at,
        lastRun: task.last_run || undefined,
        nextRun: task.next_run || undefined,
      }

      await scheduleTask(scheduledTask, false)
    }

    console.log('[SchedulerManager] All active tasks loaded and scheduled')
  } catch (error) {
    console.error('[SchedulerManager] Failed to load tasks:', error)
  }
}

/**
 * Schedule a single task
 */
export async function scheduleTask(
  task: ScheduledTask,
  saveToDb: boolean = true
): Promise<boolean> {
  let persisted = false
  try {
    const scheduleType = task.scheduleType || 'recurring'
    if (scheduleType === 'once') {
      if (!task.triggerAt) return false
      if (saveToDb) {
        await saveTaskToDb(task)
        persisted = true
      }
      armOneShotTask(task)
      return true
    }

    if (!task.cronExpression || !cron.validate(task.cronExpression)) {
      console.error(
        `[SchedulerManager] Invalid cron expression: ${task.cronExpression}`
      )
      return false
    }

    if (saveToDb) {
      await saveTaskToDb(task)
      persisted = true
    }
    const cronJob = cron.createTask(
      task.cronExpression,
      async () => {
        console.log(`[SchedulerManager] Executing task: ${task.name}`)
        await executeTask(task)

        const now = new Date().toISOString()
        updateTaskLastRun(task.id, now)
      },
      {
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }
    )

    cronJob.start()

    activeCronJobs.set(task.id, cronJob)

    console.log(
      `[SchedulerManager] Task scheduled: ${task.name} (${task.cronExpression})`
    )
    return true
  } catch (error) {
    if (persisted) {
      try {
        getDBInstance()
          .prepare('DELETE FROM scheduled_tasks WHERE id = ?')
          .run(task.id)
      } catch (rollbackError) {
        console.error('[SchedulerManager] Failed to roll back scheduled task:', rollbackError)
      }
    }
    console.error(
      `[SchedulerManager] Failed to schedule task ${task.name}:`,
      error
    )
    return false
  }
}

function armOneShotTask(task: ScheduledTask): void {
  const existing = activeOneShotTimers.get(task.id)
  if (existing) clearTimeout(existing)
  const triggerMs = Date.parse(task.triggerAt || '')
  if (!Number.isFinite(triggerMs)) return
  const arm = () => {
    const remaining = triggerMs - Date.now()
    const delay = Math.max(0, Math.min(remaining, MAX_TIMEOUT_DELAY_MS))
    const timer = setTimeout(async () => {
      if (triggerMs - Date.now() > 0) {
        arm()
        return
      }
      activeOneShotTimers.delete(task.id)
      await claimAndExecuteOneShot(task)
    }, delay)
    activeOneShotTimers.set(task.id, timer)
  }
  arm()
}

async function claimAndExecuteOneShot(task: ScheduledTask): Promise<void> {
  const now = new Date().toISOString()
  const result = getDBInstance()
    .prepare(
      'UPDATE scheduled_tasks SET is_active = 0, last_run = ?, next_run = NULL WHERE id = ? AND is_active = 1'
    )
    .run(now, task.id)
  if (result.changes !== 1) return
  task.isActive = false
  task.lastRun = now
  await executeTask(task)
}

/**
 * Execute a scheduled task
 */
async function executeTask(task: ScheduledTask): Promise<void> {
  try {
    if (task.actionType === 'command') {
      console.log(`[SchedulerManager] Executing command: ${task.details}`)
      const { stdout, stderr } = await execAsync(task.details)

      if (stderr) {
        console.warn(`[SchedulerManager] Command stderr: ${stderr}`)
      }
      if (stdout) {
        console.log(`[SchedulerManager] Command stdout: ${stdout}`)
      }
    } else if (task.actionType === 'reminder') {
      console.log(`[SchedulerManager] Sending reminder: ${task.details}`)
      const allWindows = webContents.getAllWebContents()

      for (const wc of allWindows) {
        if (!wc.isDestroyed()) {
          wc.send('scheduler:reminder', {
            taskId: task.id,
            taskName: task.name,
            message: task.details,
            timestamp: new Date().toISOString(),
          })
        }
      }
      try {
        if (Notification.isSupported()) {
          new Notification({ title: task.name, body: task.details }).show()
        }
      } catch (error) {
        console.warn('[SchedulerManager] Failed to show reminder notification:', error)
      }
    }
  } catch (error) {
    console.error(
      `[SchedulerManager] Failed to execute task ${task.name}:`,
      error
    )
  }
}

/**
 * Save task to database
 */
async function saveTaskToDb(task: ScheduledTask): Promise<void> {
  const db = getDBInstance()

  try {
    const stmt = db.prepare(`
      INSERT INTO scheduled_tasks 
      (id, name, cron_expression, action_type, details, is_active, created_at, last_run, next_run, schedule_type, trigger_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    stmt.run(
      task.id,
      task.name,
      task.cronExpression || '',
      task.actionType,
      task.details,
      task.isActive ? 1 : 0,
      task.createdAt,
      task.lastRun || null,
      task.nextRun || task.triggerAt || null,
      task.scheduleType || 'recurring',
      task.triggerAt || null
    )

    console.log(`[SchedulerManager] Task saved to database: ${task.id}`)
  } catch (error) {
    console.error('[SchedulerManager] Failed to save task to database:', error)
    throw error
  }
}

/**
 * Update task's last run time
 */
function updateTaskLastRun(taskId: string, lastRun: string): void {
  const db = getDBInstance()

  try {
    const stmt = db.prepare(
      'UPDATE scheduled_tasks SET last_run = ? WHERE id = ?'
    )
    stmt.run(lastRun, taskId)
  } catch (error) {
    console.error('[SchedulerManager] Failed to update last run time:', error)
  }
}

/**
 * Create a new scheduled task
 */
export async function createScheduledTask(
  name: string,
  cronExpression: string,
  actionType: 'command' | 'reminder',
  details: string,
  options?: { scheduleType?: 'recurring' | 'once'; triggerAt?: string }
): Promise<{
  success: boolean
  taskId?: string
  triggerAt?: string
  localTimeZone?: string
  error?: string
}> {
  try {
    const scheduleType = options?.scheduleType || 'recurring'
    let normalizedTriggerAt: string | undefined
    let localTimeZone: string | undefined
    if (scheduleType === 'once') {
      if (actionType !== 'reminder') {
        return { success: false, error: 'One-time scheduling only supports reminders.' }
      }
      const normalized = normalizeTriggerAt(String(options?.triggerAt || ''))
      normalizedTriggerAt = normalized.iso
      localTimeZone = normalized.localTimeZone
    }
    const task: ScheduledTask = {
      id: randomUUID(),
      name,
      cronExpression: scheduleType === 'recurring' ? cronExpression : undefined,
      scheduleType,
      triggerAt: normalizedTriggerAt,
      actionType,
      details,
      isActive: true,
      createdAt: new Date().toISOString(),
    }

    const success = await scheduleTask(task, true)

    if (success) {
      return {
        success: true,
        taskId: task.id,
        triggerAt: normalizedTriggerAt,
        localTimeZone,
      }
    } else {
      return { success: false, error: 'Failed to schedule task' }
    }
  } catch (error) {
    console.error('[SchedulerManager] Failed to create task:', error)
    return { success: false, error: String(error) }
  }
}

/**
 * Get all scheduled tasks
 */
export function getAllScheduledTasks(): ScheduledTask[] {
  const db = getDBInstance()

  try {
    const tasks = db
      .prepare('SELECT * FROM scheduled_tasks ORDER BY created_at DESC')
      .all() as Array<{
      id: string
      name: string
      cron_expression: string
      action_type: string
      details: string
      is_active: number
      created_at: string
      last_run: string | null
      next_run: string | null
      schedule_type: string
      trigger_at: string | null
    }>

    return tasks.map(task => ({
      id: task.id,
      name: task.name,
      cronExpression: task.cron_expression || undefined,
      scheduleType: task.schedule_type === 'once' ? 'once' : 'recurring',
      triggerAt: task.trigger_at || undefined,
      actionType: task.action_type as 'command' | 'reminder',
      details: task.details,
      isActive: task.is_active === 1,
      createdAt: task.created_at,
      lastRun: task.last_run || undefined,
      nextRun: task.next_run || undefined,
    }))
  } catch (error) {
    console.error('[SchedulerManager] Failed to get tasks:', error)
    return []
  }
}

/**
 * Delete a scheduled task
 */
export async function deleteScheduledTask(taskId: string): Promise<boolean> {
  try {
    const cronJob = activeCronJobs.get(taskId)
    if (cronJob) {
      cronJob.stop()
      cronJob.destroy()
      activeCronJobs.delete(taskId)
    }
    const oneShotTimer = activeOneShotTimers.get(taskId)
    if (oneShotTimer) {
      clearTimeout(oneShotTimer)
      activeOneShotTimers.delete(taskId)
    }

    const db = getDBInstance()
    const stmt = db.prepare('DELETE FROM scheduled_tasks WHERE id = ?')
    const result = stmt.run(taskId)

    if (result.changes > 0) {
      console.log(`[SchedulerManager] Task deleted: ${taskId}`)
      return true
    } else {
      console.log(`[SchedulerManager] Task not found: ${taskId}`)
      return false
    }
  } catch (error) {
    console.error('[SchedulerManager] Failed to delete task:', error)
    return false
  }
}

/**
 * Toggle task active status
 */
export async function toggleTaskStatus(taskId: string): Promise<boolean> {
  try {
    const db = getDBInstance()

    const task = db
      .prepare('SELECT * FROM scheduled_tasks WHERE id = ?')
      .get(taskId) as any
    if (!task) {
      return false
    }

    const newStatus = task.is_active === 1 ? 0 : 1
    if (
      newStatus === 1 &&
      task.schedule_type === 'once' &&
      Date.parse(task.trigger_at || '') <= Date.now()
    ) {
      return false
    }

    const stmt = db.prepare(
      'UPDATE scheduled_tasks SET is_active = ? WHERE id = ?'
    )
    stmt.run(newStatus, taskId)

    const cronJob = activeCronJobs.get(taskId)
    if (newStatus === 1) {
      if (!cronJob) {
        const scheduledTask: ScheduledTask = {
          id: task.id,
          name: task.name,
          cronExpression: task.cron_expression,
          scheduleType: task.schedule_type === 'once' ? 'once' : 'recurring',
          triggerAt: task.trigger_at || undefined,
          actionType: task.action_type,
          details: task.details,
          isActive: true,
          createdAt: task.created_at,
          lastRun: task.last_run || undefined,
          nextRun: task.next_run || undefined,
        }
        await scheduleTask(scheduledTask, false)
      }
    } else {
      if (cronJob) {
        cronJob.stop()
        cronJob.destroy()
        activeCronJobs.delete(taskId)
      }
      const oneShotTimer = activeOneShotTimers.get(taskId)
      if (oneShotTimer) {
        clearTimeout(oneShotTimer)
        activeOneShotTimers.delete(taskId)
      }
    }

    console.log(
      `[SchedulerManager] Task ${taskId} ${newStatus === 1 ? 'activated' : 'deactivated'}`
    )
    return true
  } catch (error) {
    console.error('[SchedulerManager] Failed to toggle task status:', error)
    return false
  }
}

/**
 * Shutdown all scheduled tasks
 */
export function shutdownScheduler(): void {
  console.log('[SchedulerManager] Shutting down scheduler...')

  for (const [taskId, cronJob] of activeCronJobs) {
    try {
      cronJob.stop()
      cronJob.destroy()
      console.log(`[SchedulerManager] Stopped task: ${taskId}`)
    } catch (error) {
      console.error(`[SchedulerManager] Error stopping task ${taskId}:`, error)
    }
  }

  activeCronJobs.clear()
  for (const timer of activeOneShotTimers.values()) clearTimeout(timer)
  activeOneShotTimers.clear()
  console.log('[SchedulerManager] Scheduler shutdown complete')
}
