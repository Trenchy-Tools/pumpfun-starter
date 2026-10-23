/**
 * Settings: `_app/settings.json` in the wallet folder (written by the Settings sheet) over `.env` defaults.
 *   apiKey           TRENCHY_API_KEY
 *   apiUrl           TRENCHY_API_URL      default https://api.trenchytools.lol
 *   jitoTipLamports  JITO_TIP_LAMPORTS    default 5_000_000 (0.005 SOL), paid inside the create transaction of a bundle
 *   slippage         (percent)            default 15
 *   mainWallet       the ★ wallet (public key): pays for everything, receives gathers, is the default creator
 */
import { SETTINGS_FILE, readJson, writeJson } from "./paths"

export const DEFAULT_API_URL = "https://api.trenchytools.lol"
const DEFAULT_TIP_LAMPORTS = 5_000_000
const DEFAULT_SLIPPAGE = 15

export type Settings = { apiKey?: string; apiUrl?: string; jitoTipLamports?: number; slippage?: number; mainWallet?: string }

export function readSettings(): Settings {
  const raw = readJson<Settings>(SETTINGS_FILE, {})
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined)
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined)
  return { apiKey: str(raw.apiKey), apiUrl: str(raw.apiUrl), jitoTipLamports: num(raw.jitoTipLamports), slippage: num(raw.slippage), mainWallet: str(raw.mainWallet) }
}

/** A field left undefined keeps its value; null or "" clears it (back to the .env default). */
export function updateSettings(patch: { [K in keyof Settings]?: Settings[K] | null }): Settings {
  const next: Settings = { ...readSettings() }
  for (const k of ["apiKey", "apiUrl", "mainWallet"] as const) {
    if (patch[k] === undefined) continue
    const v = typeof patch[k] === "string" ? patch[k]!.trim() : ""
    if (v) next[k] = v
    else delete next[k]
  }
  for (const k of ["jitoTipLamports", "slippage"] as const) {
    if (patch[k] === undefined) continue
    const v = patch[k]
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) next[k] = v
    else delete next[k]
  }
  writeJson(SETTINGS_FILE, next)
  return next
}

export type Effective = { apiUrl: string; apiKey: string; jitoTipLamports: number; slippage: number; apiKeyFrom: "settings" | "env" | "none" }

/** What the app actually uses: settings.json over .env over the built-in default. */
export function effectiveSettings(): Effective {
  const s = readSettings()
  const envKey = (process.env.TRENCHY_API_KEY || "").trim()
  return {
    apiUrl: (s.apiUrl || process.env.TRENCHY_API_URL || DEFAULT_API_URL).trim().replace(/\/+$/, ""),
    apiKey: s.apiKey || envKey,
    jitoTipLamports: s.jitoTipLamports ?? (Number(process.env.JITO_TIP_LAMPORTS) || DEFAULT_TIP_LAMPORTS),
    slippage: s.slippage ?? DEFAULT_SLIPPAGE,
    apiKeyFrom: s.apiKey ? "settings" : envKey ? "env" : "none",
  }
}
