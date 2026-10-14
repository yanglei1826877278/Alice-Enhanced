import { dialog } from 'electron'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import YAML from 'yaml'
import type {
  ActivatedSkill,
  AliceSkill,
  SkillsSnapshot,
} from '../../types/skills'
import { getCustomizationRoot } from './storagePaths'

const MAX_SKILL_BYTES = 256 * 1024
const MAX_RESOURCE_BYTES = 512 * 1024
const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function installRoot(): string {
  return path.join(getCustomizationRoot(), 'skills')
}

function roots(): Array<{ directory: string; source: AliceSkill['source'] }> {
  return [{ directory: installRoot(), source: 'alice' }]
}

function userSkillsRoot(): string {
  return path.join(os.homedir(), '.agents', 'skills')
}

interface SkillsState {
  disabled: string[]
  userSkills: string[]
}

async function stateFile(): Promise<string> {
  const root = installRoot()
  await fs.mkdir(root, { recursive: true })
  return path.join(root, '.alice-skills.json')
}

async function readState(): Promise<SkillsState> {
  try {
    const parsed = JSON.parse(await fs.readFile(await stateFile(), 'utf8'))
    return {
      disabled: Array.isArray(parsed.disabled)
        ? parsed.disabled.filter((value: unknown) => typeof value === 'string')
        : [],
      userSkills: Array.isArray(parsed.userSkills)
        ? parsed.userSkills.filter(
            (value: unknown): value is string =>
              typeof value === 'string' &&
              value !== '.' &&
              value !== '..' &&
              path.basename(value) === value
          )
        : [],
    }
  } catch {
    return { disabled: [], userSkills: [] }
  }
}

async function writeState(state: SkillsState): Promise<void> {
  await fs.writeFile(await stateFile(), JSON.stringify(state, null, 2), 'utf8')
}

async function parseSkill(
  directory: string,
  source: AliceSkill['source'],
  disabled: Set<string>
): Promise<AliceSkill> {
  const errors: string[] = []
  const folderName = path.basename(directory)
  let frontmatter: Record<string, unknown> = {}
  try {
    const file = path.join(directory, 'SKILL.md')
    const stat = await fs.stat(file)
    if (stat.size > MAX_SKILL_BYTES)
      throw new Error('SKILL.md is too large (256 KB maximum).')
    const raw = await fs.readFile(file, 'utf8')
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
    if (!match)
      throw new Error('SKILL.md needs YAML frontmatter between --- lines.')
    const document = YAML.parseDocument(match[1], { uniqueKeys: true })
    if (document.errors.length) throw new Error(document.errors[0].message)
    const parsed = document.toJS()
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('Frontmatter must be a YAML mapping.')
    frontmatter = parsed as Record<string, unknown>
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error))
  }

  const name = frontmatter.name
  const description = frontmatter.description
  if (
    typeof name !== 'string' ||
    !NAME_PATTERN.test(name) ||
    name.length > 64 ||
    name !== folderName
  ) {
    errors.push(
      'name must match the folder and use 1–64 lowercase letters, digits, or hyphens.'
    )
  }
  if (
    typeof description !== 'string' ||
    !description.trim() ||
    description.length > 1024
  ) {
    errors.push('description must contain 1–1024 characters.')
  }
  const metadata = frontmatter.metadata
  return {
    name: typeof name === 'string' ? name : folderName,
    description: typeof description === 'string' ? description : '',
    directory,
    source,
    enabled: !disabled.has(folderName),
    isValid: errors.length === 0,
    errors,
    compatibility:
      typeof frontmatter.compatibility === 'string'
        ? frontmatter.compatibility
        : undefined,
    license:
      typeof frontmatter.license === 'string' ? frontmatter.license : undefined,
    metadata:
      metadata && typeof metadata === 'object' && !Array.isArray(metadata)
        ? Object.fromEntries(
            Object.entries(metadata).filter(
              (entry): entry is [string, string] => typeof entry[1] === 'string'
            )
          )
        : undefined,
    manualOnly:
      frontmatter['disable-model-invocation'] === true ||
      frontmatter['alice-manual-only'] === true,
  }
}

export async function listSkills(): Promise<SkillsSnapshot> {
  const state = await readState()
  const disabled = new Set(state.disabled)
  const found = new Map<string, AliceSkill>()
  const diagnostics: string[] = []
  for (const root of roots()) {
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(root.directory, { withFileTypes: true })
    } catch (error: any) {
      if (error?.code !== 'ENOENT')
        diagnostics.push(`Cannot scan ${root.directory}: ${error.message}`)
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
      const directory = path.join(root.directory, entry.name)
      try {
        const stat = await fs.stat(directory)
        if (!stat.isDirectory()) continue
        await fs.access(path.join(directory, 'SKILL.md'))
        const skill = await parseSkill(directory, root.source, disabled)
        // Alice-installed skills take precedence over user-global skills.
        if (skill.isValid || !found.get(skill.name)?.isValid) {
          found.set(skill.name, skill)
        }
      } catch (error: any) {
        if (error?.code !== 'ENOENT')
          diagnostics.push(`Cannot load ${directory}: ${error.message}`)
      }
    }
  }
  for (const folderName of state.userSkills) {
    const directory = path.join(userSkillsRoot(), folderName)
    try {
      const stat = await fs.stat(directory)
      if (!stat.isDirectory()) continue
      await fs.access(path.join(directory, 'SKILL.md'))
      const skill = await parseSkill(directory, 'user', disabled)
      const existing = found.get(skill.name)
      if (!existing || (!existing.isValid && skill.isValid)) {
        found.set(skill.name, skill)
      }
    } catch (error: any) {
      if (error?.code !== 'ENOENT')
        diagnostics.push(`Cannot load ${directory}: ${error.message}`)
    }
  }
  return {
    skills: [...found.values()].sort((a, b) => a.name.localeCompare(b.name)),
    installRoot: installRoot(),
    diagnostics,
  }
}

export async function scanUserSkills(): Promise<SkillsSnapshot> {
  const state = await readState()
  const discovered: string[] = []
  try {
    const entries = await fs.readdir(userSkillsRoot(), { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
      const directory = path.join(userSkillsRoot(), entry.name)
      try {
        if (!(await fs.stat(directory)).isDirectory()) continue
        await fs.access(path.join(directory, 'SKILL.md'))
        discovered.push(entry.name)
      } catch (error: any) {
        if (error?.code !== 'ENOENT') throw error
      }
    }
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error
  }
  await writeState({
    ...state,
    userSkills: discovered.sort((a, b) => a.localeCompare(b)),
  })
  return listSkills()
}

async function availableSkill(name: string): Promise<AliceSkill> {
  const skill = (await listSkills()).skills.find(item => item.name === name)
  if (!skill || !skill.enabled || !skill.isValid)
    throw new Error(`Skill "${name}" is unavailable.`)
  return skill
}

async function safeSkillFile(
  skill: AliceSkill,
  relativePath: string
): Promise<string> {
  if (
    !relativePath ||
    path.isAbsolute(relativePath) ||
    relativePath.includes('\0')
  )
    throw new Error('Use a relative skill file path.')
  const root = await fs.realpath(skill.directory)
  const candidate = await fs.realpath(path.resolve(root, relativePath))
  const relative = path.relative(root, candidate)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
    throw new Error('File must be inside the skill directory.')
  if (!(await fs.stat(candidate)).isFile())
    throw new Error('Skill resource is not a file.')
  return candidate
}

export async function activateSkill(name: string): Promise<ActivatedSkill> {
  const skill = await availableSkill(name)
  const file = await safeSkillFile(skill, 'SKILL.md')
  const stat = await fs.stat(file)
  if (stat.size > MAX_SKILL_BYTES) throw new Error('SKILL.md is too large.')
  return {
    name,
    content: await fs.readFile(file, 'utf8'),
    directory: skill.directory,
  }
}

export async function readSkillResource(
  name: string,
  relativePath: string
): Promise<string> {
  const skill = await availableSkill(name)
  const file = await safeSkillFile(skill, relativePath)
  if ((await fs.stat(file)).size > MAX_RESOURCE_BYTES)
    throw new Error('Skill resource is too large (512 KB maximum).')
  if (!/\.(?:md|txt|json|ya?ml|csv|ts|js|mjs|cjs|py|sh|ps1)$/i.test(file))
    throw new Error('This skill resource is not a supported text file.')
  return fs.readFile(file, 'utf8')
}

export async function toggleSkill(
  name: string,
  enabled: boolean
): Promise<SkillsSnapshot> {
  const snapshot = await listSkills()
  if (!snapshot.skills.some(skill => skill.name === name))
    throw new Error(`Skill "${name}" was not found.`)
  const state = await readState()
  const disabled = new Set(state.disabled)
  if (enabled) disabled.delete(name)
  else disabled.add(name)
  await writeState({ ...state, disabled: [...disabled] })
  return listSkills()
}

export async function importSkillFolder(): Promise<SkillsSnapshot | null> {
  const selection = await dialog.showOpenDialog({
    properties: ['openDirectory'],
  })
  if (selection.canceled || !selection.filePaths[0]) return null
  const source = selection.filePaths[0]
  const name = path.basename(source)
  if ((await fs.lstat(path.join(source, 'SKILL.md'))).isSymbolicLink()) {
    throw new Error('Imported SKILL.md must be a regular file.')
  }
  const candidate = await parseSkill(source, 'alice', new Set())
  if (!candidate.isValid || !NAME_PATTERN.test(name))
    throw new Error(candidate.errors.join(' '))
  const target = path.join(installRoot(), name)
  try {
    await fs.access(target)
    throw new Error(`Skill "${name}" is already installed in Alice.`)
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error
  }
  await fs.mkdir(installRoot(), { recursive: true })
  await fs.cp(source, target, {
    recursive: true,
    errorOnExist: true,
    force: false,
    filter: async file => {
      const relative = path.relative(source, file)
      if (relative.startsWith('..') || path.isAbsolute(relative)) return false
      return !(await fs.lstat(file)).isSymbolicLink()
    },
  })
  return listSkills()
}

export async function removeInstalledSkill(
  name: string
): Promise<SkillsSnapshot> {
  const skill = (await listSkills()).skills.find(item => item.name === name)
  if (!skill || skill.source !== 'alice')
    throw new Error('Only Alice-installed skills can be removed here.')
  const root = await fs.realpath(installRoot())
  const target = await fs.realpath(skill.directory)
  if (
    path.dirname(target) !== root ||
    path.isAbsolute(path.relative(root, target))
  )
    throw new Error('Invalid installed skill path.')
  await fs.rm(target, { recursive: true, force: false })
  return listSkills()
}
