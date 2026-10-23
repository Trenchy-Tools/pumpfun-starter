/**
 * Where this app keeps its files. There is exactly one folder: the wallet backup folder.
 *
 *   WALLET_BACKUP_DIR            when set
 *   ~/Desktop/trenchytools-wallets   when a Desktop folder exists
 *   ~/trenchytools-wallets       otherwise
 *
 * Wallet files live at its top level (one JSON per wallet + wallets.csv); sibling starters share the folder, each
 * tagging its files with a `chain`. This app's own state sits in `_app/pumpfun-starter/`: settings.json,
 * launches.json, vanity-pool.json. Nothing else is stored anywhere.
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

export const BACKUP_DIR: string = (() => {
  const env = (process.env.WALLET_BACKUP_DIR || "").trim()
  if (env) return path.resolve(env)
  const desktop = path.join(os.homedir(), "Desktop")
  return path.join(fs.existsSync(desktop) ? desktop : os.homedir(), "trenchytools-wallets")
})()

export const APP_DIR = path.join(BACKUP_DIR, "_app", "pumpfun-starter")
export const SETTINGS_FILE = path.join(APP_DIR, "settings.json")
export const LAUNCHES_FILE = path.join(APP_DIR, "launches.json")
export const VANITY_POOL_FILE = path.join(APP_DIR, "vanity-pool.json")

/** Create the folders (idempotent). */
export function ensureDirs(): void {
  fs.mkdirSync(APP_DIR, { recursive: true })
}

/** Read a JSON file, or the fallback when it is missing or unreadable. */
export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T
  } catch {
    return fallback
  }
}

/** Write a JSON file atomically (write a temp file, then rename over the old one). */
export function writeJson(file: string, data: unknown, mode = 0o600): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode })
  fs.renameSync(tmp, file)
}

/**
 * Server state that must survive a dev-server hot reload (timers, launch logs, the trade feed): module scope is
 * re-created on reload, `globalThis` is not.
 */
export function serverState<T>(key: string, init: () => T): T {
  const g = globalThis as unknown as Record<string, T>
  const k = `__pumpfun_starter_${key}`
  if (!(k in g)) g[k] = init()
  return g[k]
}
