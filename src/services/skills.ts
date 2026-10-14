import type OpenAI from 'openai'
import type { ActivatedSkill, SkillsSnapshot } from '../../types/skills'

const activatedSkills = new Set<string>()

export async function getSkills(): Promise<SkillsSnapshot> {
  if (!window.skillsAPI) return { skills: [], installRoot: '', diagnostics: [] }
  const response = await window.skillsAPI.list()
  if (!response.success || !response.data)
    throw new Error(response.error || 'Could not load skills.')
  return response.data
}

export async function activateSkill(name: string): Promise<ActivatedSkill> {
  if (!window.skillsAPI)
    throw new Error('Skills are unavailable outside the desktop app.')
  const response = await window.skillsAPI.activate(name)
  if (!response.success || !response.data)
    throw new Error(response.error || `Could not activate ${name}.`)
  activatedSkills.add(name)
  return response.data
}

export async function readSkillFile(
  name: string,
  file: string
): Promise<string> {
  if (!activatedSkills.has(name))
    throw new Error(`Activate skill ${name} before reading its files.`)
  if (!window.skillsAPI)
    throw new Error('Skills are unavailable outside the desktop app.')
  const response = await window.skillsAPI.readFile(name, file)
  if (!response.success || response.data === undefined)
    throw new Error(response.error || `Could not read ${file}.`)
  return response.data
}

export async function injectExplicitSkill(
  input: OpenAI.Responses.Request.InputItemLike[],
  includeEarlierMessages = false
): Promise<OpenAI.Responses.Request.InputItemLike[]> {
  let match: RegExpMatchArray | null = null
  let messageIndex = -1
  for (let index = input.length - 1; index >= 0; index--) {
    const message = input[index] as any
    if (message?.role !== 'user') {
      if (!includeEarlierMessages) break
      continue
    }
    const content =
      typeof message.content === 'string'
        ? message.content
        : Array.isArray(message.content)
          ? message.content
              .filter((part: any) => part.type === 'input_text')
              .map((part: any) => part.text)
              .join(' ')
          : ''
    match = content.trim().match(/^\$([a-z0-9]+(?:-[a-z0-9]+)*)(?:\s|$)/)
    if (match) {
      messageIndex = index
      break
    }
    if (!includeEarlierMessages) break
  }
  if (!match || messageIndex < 0) return input
  const skill = await activateSkill(match[1])
  return [
    ...input.slice(0, messageIndex),
    {
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: `The user explicitly invoked the ${skill.name} skill. Follow its instructions for this request. Resolve relative references against ${skill.directory}. Use read_skill_file for text resources. Execute scripts only through available tools and their normal permission checks.\n\n${skill.content}`,
        },
      ],
    } as any,
    input[messageIndex],
    ...input.slice(messageIndex + 1),
  ]
}
