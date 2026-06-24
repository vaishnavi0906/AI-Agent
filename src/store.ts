import Database from 'better-sqlite3'
import path from 'node:path'
import fs from 'node:fs'

export interface HealedEntry {
  original: string
  healed: string
  page_url: string
  confidence: number
  strategy: string
  heal_count: number
  last_healed: string
}

export class LocatorStore {
  private db: Database.Database

  constructor(dbPath = '.self-heal/locators.db') {
    const dir = path.dirname(dbPath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS healed_locators (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        original    TEXT NOT NULL,
        healed      TEXT NOT NULL,
        page_url    TEXT NOT NULL,
        confidence  REAL NOT NULL DEFAULT 1.0,
        strategy    TEXT NOT NULL DEFAULT 'visual',
        heal_count  INTEGER NOT NULL DEFAULT 1,
        last_healed TEXT NOT NULL,
        UNIQUE(original, page_url)
      )
    `)
  }

  get(original: string, pageUrl: string): HealedEntry | undefined {
    return this.db
      .prepare('SELECT * FROM healed_locators WHERE original = ? AND page_url = ?')
      .get(original, pageUrl) as HealedEntry | undefined
  }

  save(original: string, healed: string, pageUrl: string, confidence: number, strategy = 'visual') {
    this.db.prepare(`
      INSERT INTO healed_locators (original, healed, page_url, confidence, strategy, heal_count, last_healed)
      VALUES (?, ?, ?, ?, ?, 1, datetime('now'))
      ON CONFLICT(original, page_url) DO UPDATE SET
        healed      = excluded.healed,
        confidence  = excluded.confidence,
        strategy    = excluded.strategy,
        heal_count  = heal_count + 1,
        last_healed = datetime('now')
    `).run(original, healed, pageUrl, confidence, strategy)
  }

  all(): HealedEntry[] {
    return this.db
      .prepare('SELECT * FROM healed_locators ORDER BY last_healed DESC')
      .all() as HealedEntry[]
  }

  close() { this.db.close() }
}
