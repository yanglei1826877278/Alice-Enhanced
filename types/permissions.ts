export type PermissionMode = 'read-only' | 'workspace' | 'full-access'

export type PermissionCapability = 'command' | 'read' | 'write'

export type PermissionEffect = 'allow' | 'deny'

export type PermissionScope = 'session' | 'project' | 'global'

export interface PermissionRule {
  id: string
  effect: PermissionEffect
  capability: PermissionCapability
  matcher: string
  scope: PermissionScope
  projectRoot?: string
  createdAt: number
}

export interface PermissionSnapshot {
  mode: PermissionMode
  persistentRules: PermissionRule[]
  sessionRules: PermissionRule[]
}
