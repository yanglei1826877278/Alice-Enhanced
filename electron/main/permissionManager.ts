import { app, BrowserWindow, dialog, ipcMain, type WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  PermissionCapability,
  PermissionMode,
  PermissionRule,
  PermissionSnapshot,
} from '../../types/permissions'
import { isPathWithinRoot } from './securityBoundaries'
import {
  isHighRiskCommand,
  isReadOnlyCommand,
  parseCommandSegments,
} from './permissionPolicy'

const VALID_MODES = new Set<PermissionMode>([
  'read-only',
  'workspace',
  'full-access',
])

export class PermissionManager {
  private mode: PermissionMode = 'workspace'
  private persistentRules: PermissionRule[] = []
  private readonly sessionRules = new Map<number, PermissionRule[]>()
  private readonly trackedSenders = new Set<number>()
  private loadPromise: Promise<void> | null = null

  constructor() {
    this.registerIpcHandlers()
  }

  private registerIpcHandlers(): void {
    ipcMain.handle('permissions:get', async event => {
      await this.ensureLoaded()
      return { success: true, data: this.snapshot(event.sender.id) }
    })
    ipcMain.handle('permissions:set-mode', async (event, rawMode: unknown) => {
      if (!VALID_MODES.has(rawMode as PermissionMode)) {
        return { success: false, error: 'Invalid permission mode.' }
      }
      await this.ensureLoaded()
      this.mode = rawMode as PermissionMode
      await this.persist()
      return { success: true, data: this.snapshot(event.sender.id) }
    })
    ipcMain.handle('permissions:remove-rule', async (event, rawId: unknown) => {
      if (typeof rawId !== 'string' || !rawId) {
        return { success: false, error: 'A rule id is required.' }
      }
      await this.ensureLoaded()
      const before = this.persistentRules.length
      this.persistentRules = this.persistentRules.filter(
        rule => rule.id !== rawId
      )
      const session = this.sessionRules.get(event.sender.id) || []
      this.sessionRules.set(
        event.sender.id,
        session.filter(rule => rule.id !== rawId)
      )
      if (before !== this.persistentRules.length) await this.persist()
      return { success: true, data: this.snapshot(event.sender.id) }
    })
    ipcMain.handle('permissions:clear-session', async event => {
      this.sessionRules.delete(event.sender.id)
      return { success: true, data: this.snapshot(event.sender.id) }
    })
  }

  async authorizePath(
    sender: WebContents,
    capability: 'read' | 'write',
    requestedPath: string
  ): Promise<void> {
    await this.ensureLoaded()
    this.trackSender(sender)
    if (this.mode === 'read-only' && capability === 'write') {
      throw new Error('Write access is disabled in read-only mode.')
    }
    const matching = this.findPathRule(sender.id, capability, requestedPath)
    if (matching?.effect === 'deny')
      throw new Error('Path access denied by permission rule.')
    if (matching?.effect === 'allow') return
    if (this.mode === 'full-access') return

    const owner = BrowserWindow.fromWebContents(sender)
    const options = {
      type: 'warning' as const,
      buttons: [
        'Deny once',
        'Allow for session',
        'Always allow this folder',
        'Always deny this folder',
      ],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      title:
        capability === 'write'
          ? 'Allow folder changes?'
          : 'Allow folder access?',
      message:
        capability === 'write'
          ? 'Alice wants to create or modify text files in this folder and its subfolders.'
          : 'Alice wants to read this folder and its subfolders.',
      detail: requestedPath,
    }
    const confirmation = owner
      ? await dialog.showMessageBox(owner, options)
      : await dialog.showMessageBox(options)
    if (confirmation.response === 0)
      throw new Error('Directory access denied by user.')

    const rule = this.createRule(
      confirmation.response === 3 ? 'deny' : 'allow',
      capability,
      requestedPath,
      confirmation.response === 1 ? 'session' : 'project',
      confirmation.response === 1 ? undefined : requestedPath
    )
    if (rule.scope === 'session') this.addSessionRule(sender.id, rule)
    else {
      this.persistentRules.push(rule)
      await this.persist()
    }
    if (rule.effect === 'deny')
      throw new Error('Directory access denied by user.')
  }

  async authorizeCommand(
    sender: WebContents,
    command: string,
    cwd?: string,
    title = 'Allow command execution?'
  ): Promise<void> {
    await this.ensureLoaded()
    this.trackSender(sender)
    const segments = parseCommandSegments(command)
    if (!segments.length) throw new Error('A command is required.')
    const highRisk = isHighRiskCommand(command, segments)
    if (
      this.mode === 'read-only' &&
      (highRisk || segments.some(segment => !isReadOnlyCommand(segment)))
    ) {
      throw new Error('Command is not allowed in read-only mode.')
    }

    for (const segment of segments) {
      const rule = this.findCommandRule(sender.id, segment.signature, cwd)
      if (rule?.effect === 'deny')
        throw new Error('Command denied by permission rule.')
      if (rule?.effect === 'allow' && !highRisk) continue
      if (this.mode === 'read-only') continue
      if (this.mode === 'full-access') continue
      if (this.mode === 'workspace' && cwd && isReadOnlyCommand(segment))
        continue
      await this.promptForCommand(
        sender,
        command,
        segments.map(item => item.signature),
        cwd,
        highRisk,
        title
      )
      return
    }
  }

  private async promptForCommand(
    sender: WebContents,
    command: string,
    signatures: string[],
    cwd: string | undefined,
    highRisk: boolean,
    title: string
  ): Promise<void> {
    const preview =
      command.length > 4_000
        ? `${command.slice(0, 4_000)}\n\n[Command preview truncated]`
        : command
    const buttons = highRisk
      ? ['Deny', 'Run once']
      : cwd
        ? [
            'Deny once',
            'Run once',
            'Allow for session',
            'Allow in this project',
            'Always allow',
            'Always deny',
          ]
        : [
            'Deny once',
            'Run once',
            'Allow for session',
            'Always allow',
            'Always deny',
          ]
    const owner = BrowserWindow.fromWebContents(sender)
    const options = {
      type: 'warning' as const,
      buttons,
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      title,
      message: highRisk
        ? 'Alice wants to run a potentially destructive or security-sensitive command. This command cannot be permanently approved.'
        : 'Alice wants to execute a command on this computer.',
      detail: cwd ? `Working directory: ${cwd}\n\n${preview}` : preview,
    }
    const confirmation = owner
      ? await dialog.showMessageBox(owner, options)
      : await dialog.showMessageBox(options)
    if (confirmation.response === 0)
      throw new Error('Command execution denied by user.')
    if (confirmation.response === 1 || highRisk) return

    let effect: 'allow' | 'deny' = 'allow'
    let scope: 'session' | 'project' | 'global'
    if (cwd) {
      scope =
        confirmation.response === 2
          ? 'session'
          : confirmation.response === 3
            ? 'project'
            : 'global'
      if (confirmation.response === 5) effect = 'deny'
    } else {
      scope = confirmation.response === 2 ? 'session' : 'global'
      if (confirmation.response === 4) effect = 'deny'
    }
    const rules = signatures.map(signature =>
      this.createRule(
        effect,
        'command',
        signature,
        scope,
        scope === 'project' ? cwd : undefined
      )
    )
    if (scope === 'session')
      rules.forEach(rule => this.addSessionRule(sender.id, rule))
    else {
      this.persistentRules.push(...rules)
      await this.persist()
    }
    if (effect === 'deny') throw new Error('Command execution denied by user.')
  }

  private findPathRule(
    senderId: number,
    capability: 'read' | 'write',
    requestedPath: string
  ): PermissionRule | undefined {
    const rules = [
      ...(this.sessionRules.get(senderId) || []),
      ...this.persistentRules,
    ]
      .filter(rule => rule.capability === capability)
      .filter(rule => isPathWithinRoot(rule.matcher, requestedPath))
      .sort((a, b) => Number(b.effect === 'deny') - Number(a.effect === 'deny'))
    return rules[0]
  }

  private findCommandRule(
    senderId: number,
    signature: string,
    cwd?: string
  ): PermissionRule | undefined {
    const rules = [
      ...(this.sessionRules.get(senderId) || []),
      ...this.persistentRules,
    ]
      .filter(
        rule => rule.capability === 'command' && rule.matcher === signature
      )
      .filter(
        rule =>
          rule.scope !== 'project' ||
          (!!cwd &&
            !!rule.projectRoot &&
            isPathWithinRoot(rule.projectRoot, cwd))
      )
      .sort((a, b) => Number(b.effect === 'deny') - Number(a.effect === 'deny'))
    return rules[0]
  }

  private createRule(
    effect: 'allow' | 'deny',
    capability: PermissionCapability,
    matcher: string,
    scope: 'session' | 'project' | 'global',
    projectRoot?: string
  ): PermissionRule {
    return {
      id: randomUUID(),
      effect,
      capability,
      matcher,
      scope,
      projectRoot,
      createdAt: Date.now(),
    }
  }

  private addSessionRule(senderId: number, rule: PermissionRule): void {
    this.sessionRules.set(senderId, [
      ...(this.sessionRules.get(senderId) || []),
      rule,
    ])
  }

  private trackSender(sender: WebContents): void {
    if (this.trackedSenders.has(sender.id)) return
    this.trackedSenders.add(sender.id)
    sender.once?.('destroyed', () => {
      this.sessionRules.delete(sender.id)
      this.trackedSenders.delete(sender.id)
    })
  }

  private snapshot(senderId?: number): PermissionSnapshot {
    return {
      mode: this.mode,
      persistentRules: [...this.persistentRules],
      sessionRules:
        senderId == null ? [] : [...(this.sessionRules.get(senderId) || [])],
    }
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loadPromise) return this.loadPromise
    this.loadPromise = (async () => {
      try {
        const raw = await fs.readFile(this.policyFilePath(), 'utf8')
        const settings = JSON.parse(raw) as Partial<PermissionSnapshot>
        if (VALID_MODES.has(settings.mode as PermissionMode)) {
          this.mode = settings.mode as PermissionMode
        }
        if (Array.isArray(settings.persistentRules)) {
          this.persistentRules =
            settings.persistentRules.filter(isPermissionRule)
        }
      } catch (error: any) {
        if (error?.code !== 'ENOENT') {
          console.warn(
            '[Permissions] Could not load persisted policy; using workspace mode.',
            error
          )
        }
      }
    })()
    return this.loadPromise
  }

  private async persist(): Promise<void> {
    const target = this.policyFilePath()
    const temporary = `${target}.${randomUUID()}.tmp`
    await fs.mkdir(path.dirname(target), { recursive: true })
    try {
      await fs.writeFile(
        temporary,
        JSON.stringify(
          { mode: this.mode, persistentRules: this.persistentRules },
          null,
          2
        ),
        { encoding: 'utf8', mode: 0o600 }
      )
      await fs.rename(temporary, target)
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => undefined)
      throw error
    }
  }

  private policyFilePath(): string {
    return path.join(app.getPath('userData'), 'alice-permissions.json')
  }
}

function isPermissionRule(value: unknown): value is PermissionRule {
  if (!value || typeof value !== 'object') return false
  const rule = value as PermissionRule
  return (
    typeof rule.id === 'string' &&
    ['allow', 'deny'].includes(rule.effect) &&
    ['command', 'read', 'write'].includes(rule.capability) &&
    typeof rule.matcher === 'string' &&
    ['project', 'global'].includes(rule.scope) &&
    typeof rule.createdAt === 'number'
  )
}
