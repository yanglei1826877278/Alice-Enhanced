import path from 'node:path'

const SHELL_SEPARATORS = new Set(['&&', '||', ';', '|', '\n'])

function tokenizeCommand(command: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null

  const pushCurrent = () => {
    if (current) tokens.push(current)
    current = ''
  }

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]
    const next = command[index + 1]
    if (quote) {
      current += char
      if (char === quote && command[index - 1] !== '\\') quote = null
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      current += char
      continue
    }
    if ((char === '&' && next === '&') || (char === '|' && next === '|')) {
      pushCurrent()
      tokens.push(`${char}${next}`)
      index += 1
      continue
    }
    if (char === ';' || char === '|' || char === '\n') {
      pushCurrent()
      tokens.push(char)
      continue
    }
    if (/\s/.test(char)) {
      pushCurrent()
      continue
    }
    current += char
  }
  pushCurrent()
  return tokens
}

function stripQuotes(value: string): string {
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1)
  }
  return value
}

function normalizeExecutable(value: string): string {
  const executable = path.basename(stripQuotes(value)).toLowerCase()
  return executable.replace(/\.(exe|cmd|bat|ps1)$/i, '')
}

export interface CommandSegment {
  executable: string
  args: string[]
  signature: string
}

export function parseCommandSegments(command: string): CommandSegment[] {
  const tokens = tokenizeCommand(command)
  const groups: string[][] = [[]]
  for (const token of tokens) {
    if (SHELL_SEPARATORS.has(token)) {
      if (groups.at(-1)?.length) groups.push([])
      continue
    }
    groups.at(-1)!.push(stripQuotes(token))
  }

  return groups
    .filter(group => group.length > 0)
    .map(group => {
      const executable = normalizeExecutable(group[0])
      const args = group.slice(1)
      const stableArgs = args.slice(0, executable === 'git' ? 1 : 2)
      return {
        executable,
        args,
        signature: [executable, ...stableArgs].join(' ').toLowerCase(),
      }
    })
}

export function isReadOnlyCommand(segment: CommandSegment): boolean {
  const first = (segment.args[0] || '').toLowerCase()
  if (
    ['pwd', 'whoami', 'hostname', 'where', 'which', 'type'].includes(
      segment.executable
    )
  ) {
    return true
  }
  if (['ls', 'dir', 'get-childitem'].includes(segment.executable)) return true
  if (segment.executable === 'git') {
    return ['status', 'diff', 'log', 'show', 'branch', 'rev-parse'].includes(
      first
    )
  }
  if (
    ['node', 'npm', 'pnpm', 'yarn', 'python', 'python3'].includes(
      segment.executable
    )
  ) {
    return ['--version', '-v', 'version'].includes(first)
  }
  return false
}

export function isHighRiskCommand(
  command: string,
  segments: CommandSegment[]
): boolean {
  const normalized = command.toLowerCase()
  if (/(`|\$\(|\$[a-z_{]|%[^%]+%|\$env:|[<>])/i.test(command)) return true
  if (
    /\b(rm\s+(-[^\s]*r[^\s]*f|-[^\s]*f[^\s]*r)|rmdir\s+\/s|del\s+\/s|remove-item\b[^\n]*(?:-recurse|-force))\b/i.test(
      command
    )
  )
    return true
  if (
    /\b(format|diskpart|shutdown|reboot|bcdedit|reg\s+(delete|add))\b/i.test(
      command
    )
  )
    return true
  if (
    /\bgit\s+(reset\s+--hard|clean\s+-[^\s]*f|push\b[^\n]*--force)\b/i.test(
      command
    )
  )
    return true
  if (/\b(chmod\s+-r|chown\s+-r|sudo|runas)\b/i.test(command)) return true
  if (/\b(curl|wget|invoke-webrequest)\b[^\n]*(\||>)/i.test(command))
    return true
  if (/\b\.ssh\b|\bcredentials?\b|\bsecrets?\.bin\b/i.test(normalized))
    return true

  return segments.some(segment => {
    const first = (segment.args[0] || '').toLowerCase()
    return (
      (['powershell', 'pwsh', 'cmd', 'bash', 'sh'].includes(
        segment.executable
      ) &&
        ['-command', '-c', '/c'].includes(first)) ||
      (['node', 'python', 'python3'].includes(segment.executable) &&
        ['-e', '-c'].includes(first))
    )
  })
}
