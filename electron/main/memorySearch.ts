const MEMORY_FTS_MIGRATION_FLAG = 'long_term_memory_fts_unicode_v1'

const MEMORY_SEARCH_STOPWORDS = new Set([
  'как',
  'где',
  'когда',
  'что',
  'это',
  'для',
  'или',
  'если',
  'и',
  'в',
  'на',
  'с',
  'по',
  'из',
  'the',
  'and',
  'for',
  'with',
])

export function tokenizeMemoryQuery(queryText: string): string[] {
  return Array.from(
    new Set(
      queryText
        .normalize('NFKC')
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter(
          token => token.length >= 2 && !MEMORY_SEARCH_STOPWORDS.has(token)
        )
    )
  ).slice(0, 8)
}

export function buildMemoryFtsQuery(queryText: string): string | null {
  const tokens = tokenizeMemoryQuery(queryText)
  if (tokens.length === 0) return null
  return tokens.map(token => `"${token.replaceAll('"', '""')}"*`).join(' OR ')
}

export function initializeMemorySearch(db: any): void {
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS long_term_memories_fts USING fts5(
      content,
      content='long_term_memories',
      content_rowid='rowid',
      tokenize='unicode61 remove_diacritics 2'
    );
    CREATE TRIGGER IF NOT EXISTS long_term_memories_fts_insert
    AFTER INSERT ON long_term_memories BEGIN
      INSERT INTO long_term_memories_fts(rowid, content)
      VALUES (new.rowid, new.content);
    END;
    CREATE TRIGGER IF NOT EXISTS long_term_memories_fts_delete
    AFTER DELETE ON long_term_memories BEGIN
      INSERT INTO long_term_memories_fts(long_term_memories_fts, rowid, content)
      VALUES ('delete', old.rowid, old.content);
    END;
    CREATE TRIGGER IF NOT EXISTS long_term_memories_fts_update
    AFTER UPDATE OF content ON long_term_memories BEGIN
      INSERT INTO long_term_memories_fts(long_term_memories_fts, rowid, content)
      VALUES ('delete', old.rowid, old.content);
      INSERT INTO long_term_memories_fts(rowid, content)
      VALUES (new.rowid, new.content);
    END;
  `)

  const migration = db
    .prepare('SELECT completed FROM migration_flags WHERE flag_name = ?')
    .get(MEMORY_FTS_MIGRATION_FLAG) as { completed?: number } | undefined
  if (migration?.completed) return

  db.transaction(() => {
    db.prepare(
      "INSERT INTO long_term_memories_fts(long_term_memories_fts) VALUES ('rebuild')"
    ).run()
    db.prepare(
      'INSERT OR REPLACE INTO migration_flags (flag_name, completed) VALUES (?, 1)'
    ).run(MEMORY_FTS_MIGRATION_FLAG)
  })()
}
