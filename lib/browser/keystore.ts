"use client"

/**
 * The wallet store of demo mode: the visitor's browser (localStorage). Chain-agnostic; the chain-specific part (make a
 * key, parse a pasted key, sign) is lib/browser/signer-*.ts.
 *
 *   <prefix>.wallet.<publicKey>   one JSON per wallet, the same shape as a wallet file of local mode:
 *                                 { publicKey, privateKey, chain, role, label, createdAt, app }
 *   <prefix>.backedUp             { [publicKey]: ISO time the key was downloaded }
 *   <prefix>.archived             { [publicKey]: ISO time it was archived }   (kept, never listed, never used)
 *   <prefix>.main                 the ★ wallet's public key
 *
 * THE BACKUP RULE (non-negotiable): a wallet is created NOT backed up. Until its key has been downloaded it cannot be
 * funded, used in a launch, traded or gathered: `assertBackedUp` / `signerSecret` throw NotBackedUpError (409
 * not_backed_up, "download your backup first"), the same refusal local mode gives for a missing file.
 * `downloadBackup()` saves every not-yet-backed-up wallet as ONE JSON file (CSV text inside) through a normal browser
 * download, and only then marks them backed up. `exportAll()` downloads every key, any time.
 *
 * A write that the browser refuses (private window, storage full) throws: a wallet is never handed out unless it is
 * stored. Clearing the site's data deletes every key here, which is why the backup comes first.
 */
import { NotBackedUpError } from "../core/errors"
import { CSV_HEADER, KEEP_NOTE, csvLine } from "../core/wallet-record"

/** A wallet as stored: exactly the wallet-file shape (role is a free tag here; each app narrows it). */
export type KeyRecord = { publicKey: string; privateKey: string; chain: string; role: string; label: string; createdAt: string; app: string }
/** What the pages see: no secret, plus the backup state. */
export type KeyView = Omit<KeyRecord, "privateKey"> & { backedUp: boolean; backedUpAt: string | null }

const NOT_BACKED_UP_HINT = "Press “Download backup” (top bar or Wallets page): the key is saved as a file on your computer, then the wallet can be used."

// ── localStorage, carefully ─────────────────────────────────────────────────

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}
/** Write and read back; throws when the browser did not keep it. */
function write(key: string, value: unknown): void {
  const text = JSON.stringify(value)
  try {
    window.localStorage.setItem(key, text)
  } catch (e) {
    throw new Error(`This browser refused to store the data (${e instanceof Error ? e.message : e}). Private windows and full storage cannot hold wallets.`)
  }
  if (window.localStorage.getItem(key) !== text) throw new Error("This browser did not keep the data it was given; wallets cannot be stored here.")
}

/** Save a text file through a normal browser download. */
export function downloadFile(name: string, text: string, type = "application/json"): void {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.rel = "noopener"
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")

// ── the store ───────────────────────────────────────────────────────────────

export type Keystore = ReturnType<typeof createKeystore>

/**
 * One store per app. `prefix` namespaces every localStorage key; `chain` is written into each record and only records of
 * this chain are listed; `fileTag` names the downloads (trenchytools-<fileTag>-backup-<time>.json).
 */
export function createKeystore(o: { prefix: string; chain: string; app: string; fileTag: string }) {
  const K = { wallet: `${o.prefix}.wallet.`, backedUp: `${o.prefix}.backedUp`, archived: `${o.prefix}.archived`, main: `${o.prefix}.main` }
  const changed = () => window.dispatchEvent(new Event("wallets-changed"))

  /** Every record of this chain (archived too), oldest first. */
  function records(): KeyRecord[] {
    const out: KeyRecord[] = []
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i)
      if (!key?.startsWith(K.wallet)) continue
      const r = read<Partial<KeyRecord> | null>(key, null)
      if (!r || typeof r.publicKey !== "string" || typeof r.privateKey !== "string" || !r.privateKey) continue
      if (key !== K.wallet + r.publicKey || (r.chain && r.chain !== o.chain)) continue
      out.push({ publicKey: r.publicKey, privateKey: r.privateKey, chain: o.chain, role: String(r.role ?? "trader"), label: String(r.label ?? ""), createdAt: String(r.createdAt ?? ""), app: String(r.app ?? o.app) })
    }
    return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }
  const backedUpMap = () => read<Record<string, string>>(K.backedUp, {})
  const archivedMap = () => read<Record<string, string>>(K.archived, {})
  const view = (r: KeyRecord, b = backedUpMap()): KeyView => {
    const { privateKey: _s, ...rest } = r
    void _s
    return { ...rest, backedUp: !!b[r.publicKey], backedUpAt: b[r.publicKey] ?? null }
  }
  const record = (publicKey: string): KeyRecord | null => records().find((r) => r.publicKey === publicKey) ?? null

  /** Usable wallets (not archived), oldest first. */
  function list(): KeyView[] {
    const a = archivedMap(), b = backedUpMap()
    return records().filter((r) => !a[r.publicKey]).map((r) => view(r, b))
  }
  const archivedCount = () => records().filter((r) => archivedMap()[r.publicKey]).length
  /** A usable wallet (archived ones are not). */
  const get = (publicKey: string): KeyView | null => (archivedMap()[publicKey] ? null : (() => { const r = record(publicKey); return r ? view(r) : null })())
  /** Every wallet ever stored here, archived ones included: label numbers never repeat. */
  const seen = () => records().length

  /** Store a new wallet (never overwrites). Returns the stored view and whether it was already there. */
  function add(r: KeyRecord): { wallet: KeyView; existed: boolean } {
    const old = record(r.publicKey)
    if (old) return { wallet: view(old), existed: true }
    write(K.wallet + r.publicKey, { ...r, chain: o.chain, app: o.app })
    if (!main()) write(K.main, r.publicKey) // the first wallet ever becomes ★
    changed()
    return { wallet: view(record(r.publicKey)!), existed: false }
  }

  function update(publicKey: string, patch: { label?: string; role?: string }): KeyView {
    const r = record(publicKey)
    if (!r || archivedMap()[publicKey]) throw missing(publicKey)
    const next = { ...r, ...(patch.label !== undefined ? { label: patch.label } : {}), ...(patch.role !== undefined ? { role: patch.role } : {}) }
    write(K.wallet + publicKey, next)
    changed()
    return view(next)
  }

  /** The ★ wallet's public key, when it names a usable wallet. */
  function main(): string | null {
    const pk = read<string | null>(K.main, null)
    return pk && get(pk) ? pk : null
  }
  function setMain(publicKey: string): KeyView {
    const w = get(publicKey)
    if (!w) throw missing(publicKey)
    write(K.main, publicKey)
    changed()
    return w
  }

  /** Archive: kept (and in every backup / export), never listed or used again. The ★ wallet is refused. */
  function archive(publicKeys: string[]): string[] {
    const m = main()
    const a = archivedMap()
    const done: string[] = []
    for (const pk of publicKeys) {
      if (m && pk === m) throw new Error("The ★ wallet cannot be archived; star another wallet first")
      if (!record(pk) || a[pk]) continue
      a[pk] = new Date().toISOString()
      done.push(pk)
    }
    write(K.archived, a)
    changed()
    return done
  }

  // ── the backup rule ──

  const missing = (publicKey: string) => new NotBackedUpError(publicKey, `Wallet ${publicKey.slice(0, 8)}… is not in this browser; refusing to fund or use it`, "Import its key on the Wallets page first.")
  const isBackedUp = (publicKey: string) => !!backedUpMap()[publicKey]

  /** The gate: call before any coin moves into a wallet or its key signs anything. */
  function assertBackedUp(publicKey: string): void {
    if (!get(publicKey)) throw missing(publicKey)
    if (!isBackedUp(publicKey)) throw new NotBackedUpError(publicKey, `Wallet ${publicKey.slice(0, 8)}… is not backed up yet: download your backup first; refusing to fund or use it`, NOT_BACKED_UP_HINT)
  }
  /** The secret for signing: only for a usable, backed-up wallet. */
  function signerSecret(publicKey: string): string {
    assertBackedUp(publicKey)
    return record(publicKey)!.privateKey
  }
  /** The secrets to show or download (the Key button, Export keys): any stored wallet, backed up or not. */
  function secrets(publicKeys: string[]): KeyRecord[] {
    return publicKeys.map((pk) => { const r = record(pk); if (!r) throw missing(pk); return r })
  }

  /** Wallets whose key has not been downloaded yet (archived ones too: they still hold a key). */
  const pending = (): KeyView[] => { const b = backedUpMap(); return records().filter((r) => !b[r.publicKey]).map((r) => view(r, b)) }

  /** ONE file per click (browsers block or prompt on a second automatic download): a JSON with every wallet and its
   *  key, and the same rows as CSV text inside it (`csv`), so a spreadsheet copy is one paste away. */
  function download(rs: KeyRecord[], kind: "backup" | "export"): string[] {
    const base = `trenchytools-${o.fileTag}-${kind}-${stamp()}`
    const json = { app: o.app, chain: o.chain, createdAt: new Date().toISOString(), note: KEEP_NOTE, wallets: rs.map((r) => ({ ...r, archived: !!archivedMap()[r.publicKey] })), csv: CSV_HEADER + rs.map((r) => csvLine(r) + "\n").join("") }
    downloadFile(`${base}.json`, JSON.stringify(json, null, 2))
    return [`${base}.json`]
  }
  function markBackedUp(rs: KeyRecord[]): void {
    const b = backedUpMap()
    const at = new Date().toISOString()
    for (const r of rs) b[r.publicKey] ??= at
    write(K.backedUp, b)
    changed()
  }

  /** `Download backup`: the not-yet-backed-up wallets, downloaded, THEN marked backed up. */
  function downloadBackup(): { count: number; files: string[] } {
    const b = backedUpMap()
    const rs = records().filter((r) => !b[r.publicKey])
    if (!rs.length) return { count: 0, files: [] }
    const files = download(rs, "backup")
    markBackedUp(rs)
    return { count: rs.length, files }
  }
  /** `Export all keys`: every wallet stored here, any time (this is a backup too). */
  function exportAll(): { count: number; files: string[] } {
    const rs = records()
    if (!rs.length) return { count: 0, files: [] }
    const files = download(rs, "export")
    markBackedUp(rs)
    return { count: rs.length, files }
  }

  return { list, get, add, update, main, setMain, archive, archivedCount, seen, isBackedUp, assertBackedUp, signerSecret, secrets, pending, downloadBackup, exportAll, missing }
}
