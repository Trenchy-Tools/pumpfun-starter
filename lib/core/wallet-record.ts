/**
 * One wallet, as a record: the shape of a wallet file in the backup folder (local mode) and of a wallet entry in the
 * visitor's localStorage (demo mode). Roles, labels, the CSV line. No node imports.
 *
 *   { publicKey, privateKey (base58), chain: "sol", role, label, createdAt, app }
 */
export const APP_NAME = "trenchytools-pumpfun-starter"
export const CHAIN = "sol"
export const ROLES = ["funding", "bundle", "sniper", "holder", "trader"] as const
export type Role = (typeof ROLES)[number]
export const isRole = (v: unknown): v is Role => typeof v === "string" && (ROLES as readonly string[]).includes(v)

export type WalletFile = { publicKey: string; privateKey: string; chain: string; role: Role; label: string; createdAt: string; app: string }
/** What the UI sees: everything but the secret, plus the file name (local mode) or where the key lives (demo mode). */
export type WalletInfo = Omit<WalletFile, "privateKey"> & { file: string }

/** The note written into every wallet file / backup entry. */
export const KEEP_NOTE = "Keep this file. Anyone with privateKey controls the wallet."

/** The label of the i-th of `n` new wallets: "Wallet N" (N counts every wallet seen so far), or `label` (numbered when n > 1). */
export const newLabel = (label: string | undefined, n: number, i: number, nextNumber: number): string =>
  label?.trim() ? (n > 1 ? `${label.trim()} ${i + 1}` : label.trim()) : `Wallet ${nextNumber + i}`

/** createdAt stamps one millisecond apart: unique, and the list keeps its order. */
export const stampAt = (i: number) => new Date(Date.now() + i).toISOString()

/** A label as stored: trimmed, at most 60 characters, or the old one when empty. */
export const cleanLabel = (label: string | undefined, old: string) => (label?.trim() ? label.trim().slice(0, 60) : old)

// ── wallets.csv: createdAt,chain,role,label,publicKey,privateKey ─────────────────────────────────────────────────

export const CSV_HEADER = "createdAt,chain,role,label,publicKey,privateKey\n"
export const csvField = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
/** One CSV line (no newline) for a wallet. */
export const csvLine = (w: { createdAt: string; chain: string; role: string; label: string; publicKey: string; privateKey: string }) =>
  [w.createdAt, w.chain, w.role, csvField(w.label), w.publicKey, w.privateKey].join(",")
/** A whole CSV file for some wallets. */
export const csvFile = (ws: WalletFile[]) => CSV_HEADER + ws.map((w) => csvLine(w) + "\n").join("")

export function parseCsvLine(line: string): string[] {
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
