import Database from 'better-sqlite3'
import path from 'node:path'
import fs from 'node:fs'

export type LocatorType = 'css' | 'text' | 'role' | 'label' | 'placeholder' | 'testid' | 'llm'

export interface HealedRecord {
  id: number
  original: string
  healed_selector: string
  locator_type: LocatorType
  role_name: string | null    // for role-based locators
  strategy: string
  page_url: string
  heal_count: number
  confidence: number
  last_healed: string
  created_at: string
}

export interface UpsertPayload {
  original: string
  healed_selector: string
  locator_type: LocatorType
  role_name?: string
  strategy: string
  page_url: string
  confidence: number
}

export class LocatorStore {
  private db: Database.Database

  constructor(dbPath = '.healing/locators.db') {
    const dir = path.dirname(dbPath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS healed_locators (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        original      TEXT    NOT NULL,
        healed_selector TEXT  NOT NULL,
        locator_type  TEXT    NOT NULL,
        role_name     TEXT,
        strategy      TEXT    NOT NULL,
        page_url      TEXT    NOT NULL,
        heal_count    INTEGER NOT NULL DEFAULT 1,
        confidence    REAL    NOT NULL DEFAULT 1.0,
        last_healed   TEXT    NOT NULL,
        created_at    TEXT    NOT NULL,
        UNIQUE(original, page_url)
      );

      CREATE TABLE IF NOT EXISTS heal_events (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        locator_id  INTEGER NOT NULL REFERENCES healed_locators(id),
        strategy    TEXT    NOT NULL,
        success     INTEGER NOT NULL,
        duration_ms INTEGER,
        ts          TEXT    NOT NULL DEFAULT (datetime('now'))
      );
    `)
  }

  get(original: string, pageUrl: string): HealedRecord | undefined {
    return this.db
      .prepare('SELECT * FROM healed_locators WHERE original = ? AND page_url = ?')
      .get(original, pageUrl) as HealedRecord | undefined
  }

  upsert(payload: UpsertPayload): HealedRecord {
    this.db.prepare(`
      INSERT INTO healed_locators
        (original, healed_selector, locator_type, role_name, strategy, page_url, heal_count, confidence, last_healed, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, datetime('now'), datetime('now'))
      ON CONFLICT(original, page_url) DO UPDATE SET
        healed_selector = excluded.healed_selector,
        locator_type    = excluded.locator_type,
        role_name       = excluded.role_name,
        strategy        = excluded.strategy,
        heal_count      = heal_count + 1,
        confidence      = excluded.confidence,
        last_healed     = datetime('now')
    `).run(
      payload.original,
      payload.healed_selector,
      payload.locator_type,
      payload.role_name ?? null,
      payload.strategy,
      payload.page_url,
      payload.confidence,
    )

    return this.get(payload.original, payload.page_url)!
  }

  logEvent(locatorId: number, strategy: string, success: boolean, durationMs: number) {
    this.db.prepare(`
      INSERT INTO heal_events (locator_id, strategy, success, duration_ms)
      VALUES (?, ?, ?, ?)
    `).run(locatorId, strategy, success ? 1 : 0, durationMs)
  }

  stats(): { strategy: string; count: number; avg_confidence: number; avg_heals: number }[] {
    return this.db.prepare(`
      SELECT
        strategy,
        COUNT(*)          AS count,
        AVG(confidence)   AS avg_confidence,
        AVG(heal_count)   AS avg_heals
      FROM healed_locators
      GROUP BY strategy
      ORDER BY count DESC
    `).all() as ReturnType<LocatorStore['stats']>
  }

  all(): HealedRecord[] {
    return this.db.prepare('SELECT * FROM healed_locators ORDER BY last_healed DESC').all() as HealedRecord[]
  }

  close() {
    this.db.close()
  }
}
