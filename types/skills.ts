export interface AliceSkill {
  name: string
  description: string
  directory: string
  source: 'alice' | 'user'
  enabled: boolean
  isValid: boolean
  errors: string[]
  compatibility?: string
  license?: string
  metadata?: Record<string, string>
  manualOnly?: boolean
}

export interface SkillsSnapshot {
  skills: AliceSkill[]
  installRoot: string
  diagnostics: string[]
}

export interface ActivatedSkill {
  name: string
  content: string
  directory: string
}
