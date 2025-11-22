import { dirname, join } from "node:path"
import { mkdirSync } from "node:fs"
import { homedir } from "node:os"

const DB_PATH = join(homedir(), ".local", "share", "glu-code", "prompts.db")

type Statement<TRow = unknown> = {
  run: (...params: unknown[]) => { lastInsertRowid?: number }
  get: (...params: unknown[]) => TRow | undefined
  all: (...params: unknown[]) => TRow[]
}

export interface DbClient {
  prepare: <TRow = unknown>(sql: string) => Statement<TRow>
  exec: (sql: string) => void
}

export function dbPath(): string {
  return DB_PATH
}

export function getDb(): DbClient {
  mkdirSync(dirname(DB_PATH), { recursive: true })

  if (isBun()) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Database } = require("bun:sqlite")
    const db = new Database(DB_PATH, { create: true, strict: true })
    db.exec("PRAGMA journal_mode = WAL;")
    return {
      prepare: <TRow = unknown>(sql: string) => {
        const stmt = db.query(sql)
        return {
          run: (...params: unknown[]) => stmt.run(...params) as { lastInsertRowid?: number },
          get: (...params: unknown[]) => stmt.get(...params) as TRow | undefined,
          all: (...params: unknown[]) => stmt.all(...params) as TRow[],
        }
      },
      exec: (sql: string) => db.exec(sql),
    }
  }

  // Node path
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const BetterSqlite3 = require("better-sqlite3") as typeof import("better-sqlite3")
  const db = new BetterSqlite3(DB_PATH)
  db.pragma("journal_mode = WAL")
  return {
    prepare: <TRow = unknown>(sql: string) => {
      const stmt = db.prepare(sql)
      return {
        run: (...params: unknown[]) => stmt.run(...params) as { lastInsertRowid?: number },
        get: (...params: unknown[]) => stmt.get(...params) as TRow | undefined,
        all: (...params: unknown[]) => stmt.all(...params) as TRow[],
      }
    },
    exec: (sql: string) => db.exec(sql),
  }
}

function isBun(): boolean {
  return typeof Bun !== "undefined"
}
