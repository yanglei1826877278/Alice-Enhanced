import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'

const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), 'alice-skills-test-'))
const chosenFolder = path.join(fixtureRoot, 'external', 'imported-skill')
const { showOpenDialog } = vi.hoisted(() => ({ showOpenDialog: vi.fn() }))
vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => 'unused' },
  dialog: { showOpenDialog },
}))

import {
  activateSkill,
  importSkillFolder,
  listSkills,
  readSkillResource,
  scanUserSkills,
  toggleSkill,
} from '../../electron/main/skillsManager'

const skillsRoot = path.join(fixtureRoot, 'user-customization', 'skills')
const userSkillsRoot = path.join(fixtureRoot, '.agents', 'skills')
const folder = path.join(skillsRoot, 'example-skill')
let cwdSpy: ReturnType<typeof vi.spyOn>
let homeSpy: ReturnType<typeof vi.spyOn>

async function writeSkill(
  directory: string,
  text = '---\nname: example-skill\ndescription: Helps with example requests.\n---\n\nFollow these steps.'
) {
  await fs.mkdir(directory, { recursive: true })
  await fs.writeFile(path.join(directory, 'SKILL.md'), text)
}

describe('skillsManager', () => {
  beforeAll(() => {
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(fixtureRoot)
    homeSpy = vi.spyOn(os, 'homedir').mockReturnValue(fixtureRoot)
  })
  afterAll(() => {
    cwdSpy.mockRestore()
    homeSpy.mockRestore()
    rmSync(fixtureRoot, { recursive: true, force: true })
  })
  beforeEach(async () => {
    await fs.rm(skillsRoot, { recursive: true, force: true })
    await fs.rm(path.join(fixtureRoot, 'external'), {
      recursive: true,
      force: true,
    })
    await fs.rm(userSkillsRoot, { recursive: true, force: true })
    showOpenDialog.mockReset()
  })

  it('does not discover user skills until a manual scan', async () => {
    const userFolder = path.join(userSkillsRoot, 'user-skill')
    await writeSkill(
      userFolder,
      '---\nname: user-skill\ndescription: A user-scoped workflow.\n---\nDo user work.'
    )

    expect((await listSkills()).skills).toHaveLength(0)
    expect((await scanUserSkills()).skills).toContainEqual(
      expect.objectContaining({ name: 'user-skill', source: 'user' })
    )
    expect((await listSkills()).skills).toContainEqual(
      expect.objectContaining({ name: 'user-skill', source: 'user' })
    )
  })

  it('discovers and activates a valid SKILL.md and reads a referenced file', async () => {
    await writeSkill(folder)
    await fs.mkdir(path.join(folder, 'references'))
    await fs.writeFile(
      path.join(folder, 'references', 'guide.md'),
      'Reference content'
    )
    const snapshot = await listSkills()
    expect(
      snapshot.skills.find(skill => skill.name === 'example-skill')
    ).toMatchObject({ isValid: true, enabled: true, source: 'alice' })
    expect((await activateSkill('example-skill')).content).toContain(
      'Follow these steps.'
    )
    expect(
      await readSkillResource('example-skill', 'references/guide.md')
    ).toBe('Reference content')
    await expect(
      readSkillResource('example-skill', '../outside.md')
    ).rejects.toThrow()
  })

  it('reports invalid metadata and keeps disabled skills unavailable', async () => {
    await writeSkill(
      folder,
      '---\nname: wrong-name\ndescription: Example\n---\nInstructions'
    )
    expect(
      (await listSkills()).skills.find(skill => skill.name === 'wrong-name')
        ?.isValid
    ).toBe(false)
    await writeSkill(folder)
    await toggleSkill('example-skill', false)
    await expect(activateSkill('example-skill')).rejects.toThrow('unavailable')
  })

  it('imports a local skill folder and rejects symlinked resources outside it', async () => {
    await writeSkill(
      chosenFolder,
      '---\nname: imported-skill\ndescription: Imported workflow.\n---\nDo the work.'
    )
    showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: [chosenFolder],
    })
    expect(
      (await importSkillFolder())?.skills.some(
        skill => skill.name === 'imported-skill'
      )
    ).toBe(true)
    await fs.symlink(
      path.join(fixtureRoot, 'outside.md'),
      path.join(skillsRoot, 'imported-skill', 'outside.md')
    )
    await fs.writeFile(path.join(fixtureRoot, 'outside.md'), 'private')
    await expect(
      readSkillResource('imported-skill', 'outside.md')
    ).rejects.toThrow('inside the skill directory')
  })
})
