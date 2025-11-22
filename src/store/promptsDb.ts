import { dbPath, getDb, type DbClient } from "./db"

export interface PromptRecord {
  id: number
  createdAt: string
  text: string
}

export interface RunRecord {
  id: number
  promptId: number
  command: string
  windowName: string | null
  createdAt: string
}

interface PromptRow {
  id: number
  created_at: string
  text: string
}

interface RunRow {
  id: number
  prompt_id: number
  command: string
  window_name: string | null
  created_at: string
}
const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS prompts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  text TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prompt_id INTEGER NOT NULL,
  command TEXT NOT NULL,
  window_name TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(prompt_id) REFERENCES prompts(id)
);
`

let db: DbClient | null = null

function ensureDb(): DbClient {
  if (db) return db
  db = getDb()
  db.exec(CREATE_TABLE_SQL)
  return db
}

export function savePrompt(text: string): PromptRecord {
  const database = ensureDb()
  const stmt = database.prepare("INSERT INTO prompts (created_at, text) VALUES (?, ?)")
  const createdAt = new Date().toISOString()
  const result = stmt.run(createdAt, text)
  return { id: Number(result.lastInsertRowid), createdAt, text }
}

export function updatePrompt(id: number, text: string): PromptRecord {
  const database = ensureDb()
  const row = database.prepare("SELECT created_at FROM prompts WHERE id = ?").get(id) as PromptRow | undefined

  if (!row?.created_at) {
    throw new Error(`Prompt with id ${id} not found`)
  }

  database.prepare("UPDATE prompts SET text = ? WHERE id = ?").run(text, id)
  return { id, createdAt: row.created_at, text }
}

export function getPrompt(id: number): PromptRecord | undefined {
  const database = ensureDb()
  const row = database.prepare("SELECT id, created_at, text FROM prompts WHERE id = ?").get(id) as PromptRow | undefined
  if (!row) return undefined
  return { id: row.id, createdAt: row.created_at, text: row.text }
}

export function getLastPrompt(): PromptRecord | undefined {
  const database = ensureDb()
  const row = database.prepare("SELECT id, created_at, text FROM prompts ORDER BY id DESC LIMIT 1").get() as PromptRow | undefined
  if (!row) return undefined
  return { id: row.id, createdAt: row.created_at, text: row.text }
}

export function listPrompts(limit = 50): PromptRecord[] {
  const database = ensureDb()
  const rows = database.prepare("SELECT id, created_at, text FROM prompts ORDER BY id DESC LIMIT ?").all(limit) as PromptRow[]
  return rows.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    text: row.text,
  }))
}

export { dbPath }

export function logRun(promptId: number, command: string, windowName?: string | null): RunRecord {
  const database = ensureDb()
  const createdAt = new Date().toISOString()
  const stmt = database.prepare("INSERT INTO runs (prompt_id, command, window_name, created_at) VALUES (?, ?, ?, ?)")
  const result = stmt.run(promptId, command, windowName ?? null, createdAt)
  return {
    id: Number(result.lastInsertRowid),
    promptId,
    command,
    windowName: windowName ?? null,
    createdAt,
  }
}

export function getLastRunForPrompt(promptId: number): RunRecord | undefined {
  const database = ensureDb()
  const row = database.prepare("SELECT * FROM runs WHERE prompt_id = ? ORDER BY id DESC LIMIT 1").get(promptId) as
    | RunRow
    | undefined
  if (!row) return undefined
  return mapRunRow(row)
}

export function listRuns(limit = 50): RunRecord[] {
  const database = ensureDb()
  const rows = database.prepare("SELECT * FROM runs ORDER BY id DESC LIMIT ?").all(limit) as RunRow[]
  return rows.map(mapRunRow)
}

export function listRunsForPrompt(promptId: number, limit = 20): RunRecord[] {
  const database = ensureDb()
  const rows = database.prepare("SELECT * FROM runs WHERE prompt_id = ? ORDER BY id DESC LIMIT ?").all(promptId, limit) as
    | RunRow[]
  return rows.map(mapRunRow)
}

function mapRunRow(row: RunRow): RunRecord {
  return {
    id: row.id,
    promptId: row.prompt_id,
    command: row.command,
    windowName: row.window_name,
    createdAt: row.created_at,
  }
}
