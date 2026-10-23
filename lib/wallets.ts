/**
 * The wallet store IS the backup folder (lib/paths.ts: BACKUP_DIR).
 *
 *   <date>-<chain>-<role>-<publicKey>.json   { publicKey, privateKey (base58), chain: "sol", role, label, createdAt, app }
 *   wallets.csv                              one line per wallet: createdAt,chain,role,label,publicKey,privateKey
 *   archived/                                wallet files taken off the list (keys kept; nothing here is ever used)
 *
 * The folder is shared with sibling starters (a Robinhood launcher, a wallet mover) that write `chain: "rh" | "eth" |
 * "bnb"` files for 0x keys. This app only lists `chain: "sol"` files (a file without `chain` counts as sol).
 *
 * One list of wallets. The ★ (main) wallet pays for everything, receives gathers and is the default creator; it is the
 * public key in `_app/pumpfun-starter/settings.json` `mainWallet`. The first wallet ever created becomes ★; a wallet
 * with the old role `funding` counts as ★ when nothing is set. `role` is only a tag now (bundle / sniper / holder /
 * trader / funding), set from the rename popover; nothing is picked by role any more.
 *
 * The app lists wallets by reading the folder. A wallet is written to disk BEFORE create/import returns, and nothing
 * is funded, used as the creator, bundled or gathered unless its file exists: assertBackedUp() throws
 * NotBackedUpError, which the routes answer as HTTP 409 { code: "not_backed_up" }. "Rewrite backups" restores a
 * missing file from its wallets.csv line and adds missing CSV lines for existing files (idempotent).
 */
import fs from "node:fs"
import path from "node:path"
import { Keypair } from "@solana/web3.js"
import bs58 from "bs58"
import { BACKUP_DIR, ensureDirs } from "./paths"
import { readSettings, updateSettings } from "./settings"

export const APP_NAME = "trenchytools-pumpfun-starter"
export const CHAIN = "sol"
export const ROLES = ["funding", "bundle", "sniper", "holder", "trader"] as const
export type Role = (typeof ROLES)[number]
export const isRole = (v: unknown): v is Role => typeof v === "string" && (ROLES as readonly string[]).includes(v)

export type WalletFile = { publicKey: string; privateKey: string; chain: string; role: Role; label: string; createdAt: string; app: string }
/** What the UI sees: everything but the secret, plus the file name. */
export type WalletInfo = Omit<WalletFile, "privateKey"> & { file: string }

const CSV_FILE = path.join(BACKUP_DIR, "wallets.csv")
const CSV_HEADER = "createdAt,chain,role,label,publicKey,privateKey\n"
const ARCHIVE_DIR = path.join(BACKUP_DIR, "archived")
const PUBKEY_RE = /-([1-9A-HJ-NP-Za-km-z]{32,44})\.json$/

export class NotBackedUpError extends Error {
  code = "not_backed_up" as const
  hint = "Run 'Rewrite backups' on the Wallets page, or restore the file from wallets.csv"
  constructor(public publicKey: string) {
    super(`Wallet ${publicKey.slice(0, 8)}… has no file in ${BACKUP_DIR}; refusing to fund or use it`)
  }
}

const publicView = (w: WalletFile, file: string): WalletInfo => ({ publicKey: w.publicKey, chain: w.chain, role: w.role, label: w.label, createdAt: w.createdAt, app: w.app, file: path.basename(file) })

/** Parse one wallet file; null when it is not a Solana wallet of this folder or the key does not match the name. */
function readFile(file: string): WalletFile | null {
  const m = PUBKEY_RE.exec(path.basename(file))
  if (!m) return null
  try {
    const w = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<WalletFile>
    if (w.publicKey !== m[1] || typeof w.privateKey !== "string" || !w.privateKey) return null
    if (w.chain && w.chain !== CHAIN) return null // another starter's wallet (rh / eth / bnb)
    const role: Role = isRole(w.role) ? w.role : "trader"
    return { publicKey: w.publicKey, privateKey: w.privateKey, chain: CHAIN, role, label: String(w.label ?? role), createdAt: String(w.createdAt ?? ""), app: String(w.app ?? "") }
  } catch {
    return null
  }
}

/** The file holding a public key (verified to exist and to hold that key), or null. Archived files do not count. */
function findFile(publicKey: string, dir = BACKUP_DIR): string | null {
  if (!fs.existsSync(dir)) return null
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(`-${publicKey}.json`)) continue
    const file = path.join(dir, name)
    if (readFile(file)?.publicKey === publicKey) return file
  }
  return null
}

/** Every Solana wallet in the folder, oldest first. */
export function listWallets(role?: Role): WalletInfo[] {
  if (!fs.existsSync(BACKUP_DIR)) return []
  const out: WalletInfo[] = []
  for (const name of fs.readdirSync(BACKUP_DIR)) {
    if (!PUBKEY_RE.test(name)) continue
    const file = path.join(BACKUP_DIR, name)
    const w = readFile(file)
    if (w && (!role || w.role === role)) out.push(publicView(w, file))
  }
  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

/** Archived wallets (files in archived/), oldest first. Keys kept; never funded, traded or used. */
export function listArchived(): WalletInfo[] {
  if (!fs.existsSync(ARCHIVE_DIR)) return []
  const out: WalletInfo[] = []
  for (const name of fs.readdirSync(ARCHIVE_DIR)) {
    if (!PUBKEY_RE.test(name)) continue
    const file = path.join(ARCHIVE_DIR, name)
    const w = readFile(file)
    if (w) out.push(publicView(w, file))
  }
  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export const getWallet = (publicKey: string): WalletInfo | null => {
  const file = findFile(publicKey)
  const w = file ? readFile(file) : null
  return w && file ? publicView(w, file) : null
}

/**
 * The ★ wallet: settings.json `mainWallet` when it names a wallet in the folder, else the wallet with the old role
 * `funding` (the role maps to ★), else null.
 */
export function mainWallet(): WalletInfo | null {
  const pk = readSettings().mainWallet
  if (pk) {
    const w = getWallet(pk)
    if (w) return w
  }
  return listWallets("funding")[0] ?? null
}
/** The old name of the ★ wallet, kept for the routes that fund, gather and launch. */
export const fundingWallet = mainWallet

/** Make a wallet the ★: it must be in the folder. */
export function setMainWallet(publicKey: string): WalletInfo {
  const w = getWallet(publicKey)
  if (!w) throw new NotBackedUpError(publicKey)
  updateSettings({ mainWallet: publicKey })
  return w
}

export const isBackedUp = (publicKey: string): boolean => !!findFile(publicKey)

/** The gate: call before any SOL moves into a wallet or a launch / trade uses its key. */
export function assertBackedUp(publicKey: string): void {
  if (!findFile(publicKey)) throw new NotBackedUpError(publicKey)
}

/** The keypair of a wallet, read from its file (the only place keys live). Throws NotBackedUpError when the file is missing. */
export function keypairOf(publicKey: string): Keypair {
  const file = findFile(publicKey)
  const w = file ? readFile(file) : null
  if (!w) throw new NotBackedUpError(publicKey)
  return Keypair.fromSecretKey(bs58.decode(w.privateKey))
}

/** The secret keys of wallets, for the Key button and Export keys. Only wallets with a file; archived ones excluded. */
export function exportKeys(publicKeys: string[]): Array<{ publicKey: string; privateKey: string; label: string; file: string }> {
  const out: Array<{ publicKey: string; privateKey: string; label: string; file: string }> = []
  for (const pk of publicKeys) {
    const file = findFile(pk)
    const w = file ? readFile(file) : null
    if (!w || !file) throw new NotBackedUpError(pk)
    out.push({ publicKey: w.publicKey, privateKey: w.privateKey, label: w.label, file: path.basename(file) })
  }
  return out
}

const safe = (s: string) => (s.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "wallet").slice(0, 40)
const csvField = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)

/**
 * Write one wallet: its JSON file (created exclusively, never overwritten) and its CSV line. Synchronous, and done
 * before the caller gets the wallet back. Returns the file path. An existing file for the key is left alone.
 */
function writeWallet(w: WalletFile): { file: string; existed: boolean } {
  ensureDirs()
  const existing = findFile(w.publicKey)
  if (existing) return { file: existing, existed: true }
  const stamp = w.createdAt.replace(/[:.]/g, "-") // colons are not allowed in Windows file names
  const file = path.join(BACKUP_DIR, `${stamp}-${w.chain}-${safe(w.role)}-${w.publicKey}.json`)
  fs.writeFileSync(file, JSON.stringify({ ...w, note: "Keep this file. Anyone with privateKey controls the wallet." }, null, 2), { flag: "wx", mode: 0o600 })
  if (!csvRows().some((r) => r.publicKey === w.publicKey)) appendCsv(w)
  console.log(`[wallets] ${w.role} ${w.publicKey.slice(0, 8)}… → ${file}`)
  return { file, existed: false }
}

function appendCsv(w: WalletFile): void {
  if (!fs.existsSync(CSV_FILE)) fs.writeFileSync(CSV_FILE, CSV_HEADER, { mode: 0o600 })
  fs.appendFileSync(CSV_FILE, [w.createdAt, w.chain, w.role, csvField(w.label), w.publicKey, w.privateKey].join(",") + "\n")
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = []
  let cur = ""
  let q = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (c === '"') q = false
      else cur += c
    } else if (c === '"') q = true
    else if (c === ",") { cells.push(cur); cur = "" }
    else cur += c
  }
  cells.push(cur)
  return cells
}

const ADDR_SHAPE = /^([1-9A-HJ-NP-Za-km-z]{32,44}|0x[0-9a-fA-F]{40})$/

/** One CSV line → this app's record, or null (another chain, not an address, no key). A 5-cell line is the older layout without `chain`. */
function csvRecord(cells: string[]): WalletFile | null {
  const [createdAt, chain, role, label, publicKey, privateKey] = cells.length >= 6 ? cells : [cells[0], CHAIN, ...cells.slice(1)]
  if ((chain || CHAIN) !== CHAIN) return null
  if (!publicKey || !privateKey || !ADDR_SHAPE.test(publicKey) || publicKey.startsWith("0x")) return null
  return { createdAt, chain: CHAIN, role: isRole(role) ? role : "trader", label: label ?? "", publicKey, privateKey, app: APP_NAME }
}

/**
 * wallets.csv as records. The folder is shared by three starters, so the layout is decided PER LINE, never by the
 * header: a 6-cell line is createdAt,chain,role,label,publicKey,privateKey; a 5-cell line is the older
 * createdAt,role,label,publicKey,privateKey (a Solana wallet). Lines whose publicKey is not an address are skipped,
 * 0x keys are never taken as Solana, duplicates collapse. Quoted labels are handled.
 */
function csvRows(): WalletFile[] {
  if (!fs.existsSync(CSV_FILE)) return []
  const rows: WalletFile[] = []
  const seen = new Set<string>()
  for (const line of fs.readFileSync(CSV_FILE, "utf8").split(/\r?\n/).slice(1)) {
    if (!line.trim()) continue
    const r = csvRecord(parseCsvLine(line))
    if (!r || seen.has(r.publicKey)) continue
    seen.add(r.publicKey)
    rows.push(r)
  }
  return rows
}

/** Rewrite the CSV line(s) of one wallet with a new label / role; every other line is kept byte for byte. Atomic. */
function patchCsv(publicKey: string, patch: { label?: string; role?: Role }): void {
  if (!fs.existsSync(CSV_FILE)) return
  const lines = fs.readFileSync(CSV_FILE, "utf8").split(/\r?\n/)
  let changed = false
  const next = lines.map((line, i) => {
    if (i === 0 || !line.trim()) return line
    const r = csvRecord(parseCsvLine(line))
    if (!r || r.publicKey !== publicKey) return line
    changed = true
    return [r.createdAt, r.chain, patch.role ?? r.role, csvField(patch.label ?? r.label), r.publicKey, r.privateKey].join(",")
  })
  if (!changed) return
  const tmp = `${CSV_FILE}.${process.pid}.tmp`
  fs.writeFileSync(tmp, next.join("\n"), { mode: 0o600 })
  fs.renameSync(tmp, CSV_FILE)
}

/** Wallets that have a CSV line but no file (deleted or moved): shown on the Wallets page, restored by rewriteBackups(). Archived wallets are not missing. */
export function missingFiles(): Array<Pick<WalletInfo, "publicKey" | "role" | "label" | "createdAt">> {
  return csvRows().filter((r) => !findFile(r.publicKey) && !findFile(r.publicKey, ARCHIVE_DIR)).map(({ publicKey, role, label, createdAt }) => ({ publicKey, role, label, createdAt }))
}

/** "Wallet N": N counts every wallet this folder has seen (listed + archived), so a new label never repeats an old one. */
function nextLabelNumber(): number {
  return listWallets().length + listArchived().length + 1
}

/** The first wallet ever created or imported becomes ★. */
function starIfFirst(publicKey: string): void {
  if (!mainWallet()) updateSettings({ mainWallet: publicKey })
}

/**
 * Create N wallets. Each file is on disk before this returns; the result carries the file paths. Labels are "Wallet N"
 * (or `label`, numbered when N > 1); `role` is only a tag, default trader. The first wallet ever created becomes ★.
 */
export function createWallets(count: number, role: Role = "trader", label?: string): Array<WalletInfo & { path: string }> {
  const n = Math.min(Math.max(Math.floor(count) || 1, 1), 100)
  const start = nextLabelNumber()
  const out: Array<WalletInfo & { path: string }> = []
  for (let i = 0; i < n; i++) {
    const kp = Keypair.generate()
    const createdAt = new Date(Date.now() + i).toISOString() // unique stamps, stable sort order
    const name = label?.trim() ? (n > 1 ? `${label.trim()} ${i + 1}` : label.trim()) : `Wallet ${start + i}`
    const w: WalletFile = { publicKey: kp.publicKey.toBase58(), privateKey: bs58.encode(kp.secretKey), chain: CHAIN, role, label: name, createdAt, app: APP_NAME }
    const { file } = writeWallet(w)
    starIfFirst(w.publicKey)
    out.push({ ...publicView(w, file), path: file })
  }
  return out
}

/** Import a base58 secret key (written to the folder first, like a created one). Becomes ★ when it is the first wallet. */
export function importWallet(secret: string, role: Role = "trader", label?: string): WalletInfo & { path: string; existed: boolean } {
  let kp: Keypair
  try {
    kp = Keypair.fromSecretKey(bs58.decode(secret.trim()))
  } catch {
    throw new Error("Not a valid base58 secret key")
  }
  const publicKey = kp.publicKey.toBase58()
  const w: WalletFile = { publicKey, privateKey: bs58.encode(kp.secretKey), chain: CHAIN, role, label: label?.trim() || `Wallet ${nextLabelNumber()}`, createdAt: new Date().toISOString(), app: APP_NAME }
  const { file, existed } = writeWallet(w)
  starIfFirst(publicKey)
  return { ...publicView(existed ? readFile(file)! : w, file), path: file, existed }
}

/** Rename a wallet and/or change its role tag: the JSON file is rewritten in place (same name), the CSV line patched. */
export function updateWallet(publicKey: string, patch: { label?: string; role?: Role }): WalletInfo {
  const file = findFile(publicKey)
  const w = file ? readFile(file) : null
  if (!w || !file) throw new NotBackedUpError(publicKey)
  const label = patch.label?.trim() ? patch.label.trim().slice(0, 60) : w.label
  const role = patch.role ?? w.role
  const next: WalletFile = { ...w, label, role }
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify({ ...next, note: "Keep this file. Anyone with privateKey controls the wallet." }, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, file)
  patchCsv(publicKey, { label, role })
  return publicView(next, file)
}

/**
 * Archive wallets: their files move to archived/ (keys kept, never used again). The ★ wallet cannot be archived; a
 * wallet without a file is skipped. Returns what moved.
 */
export function archiveWallets(publicKeys: string[]): { archived: string[]; dir: string } {
  const main = mainWallet()
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true })
  const archived: string[] = []
  for (const pk of publicKeys) {
    if (main && pk === main.publicKey) throw new Error("The ★ wallet cannot be archived; star another wallet first")
    const file = findFile(pk)
    if (!file) continue
    fs.renameSync(file, path.join(ARCHIVE_DIR, path.basename(file)))
    archived.push(pk)
    console.log(`[wallets] archived ${pk.slice(0, 8)}… → ${ARCHIVE_DIR}`)
  }
  return { archived, dir: ARCHIVE_DIR }
}

/**
 * Idempotent export: restore every wallet that has a CSV line but no file, and add a CSV line for every file that
 * has none. Returns the folder, how many files exist now and what was written.
 */
export function rewriteBackups(): { dir: string; files: number; restored: string[]; csvAdded: number } {
  ensureDirs()
  const restored: string[] = []
  for (const row of csvRows()) {
    if (findFile(row.publicKey) || findFile(row.publicKey, ARCHIVE_DIR)) continue
    const { file } = writeWallet({ ...row, createdAt: row.createdAt || new Date().toISOString() })
    restored.push(path.basename(file))
  }
  let csvAdded = 0
  const inCsv = new Set(csvRows().map((r) => r.publicKey))
  for (const name of fs.readdirSync(BACKUP_DIR)) {
    if (!PUBKEY_RE.test(name)) continue
    const w = readFile(path.join(BACKUP_DIR, name))
    if (w && !inCsv.has(w.publicKey)) { appendCsv(w); csvAdded++ }
  }
  return { dir: BACKUP_DIR, files: listWallets().length, restored, csvAdded }
}
