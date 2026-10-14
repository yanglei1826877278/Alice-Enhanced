import { describe, expect, it } from 'vitest'
import {
  buildMemoryFtsQuery,
  initializeMemorySearch,
  tokenizeMemoryQuery,
} from '../../electron/main/memorySearch'

describe('multilingual memory search', () => {
  it('normalizes Cyrillic queries for prefix matching', () => {
    expect(tokenizeMemoryQuery('ГДЕ мой ПРИВЕТ из Торонто?')).toEqual([
      'мой',
      'привет',
      'торонто',
    ])
    expect(buildMemoryFtsQuery('ПРИВЕТ')).toBe('"привет"*')
  })

  it('configures a Unicode FTS index and backfill migration', () => {
    const executed: string[] = []
    const run = () => undefined
    const db = {
      exec: (sql: string) => executed.push(sql),
      prepare: (sql: string) => ({
        get: () => undefined,
        run: (...args: unknown[]) => {
          executed.push(`${sql} ${args.join(' ')}`)
          return undefined
        },
      }),
      transaction: (callback: () => void) => callback,
    }

    initializeMemorySearch(db)

    expect(executed.join('\n')).toContain(
      "tokenize='unicode61 remove_diacritics 2'"
    )
    expect(executed.join('\n')).toContain("VALUES ('rebuild')")
  })
})
