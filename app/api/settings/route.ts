import { BACKUP_DIR, SETTINGS_FILE } from "@/lib/paths"
import { body, fail, ok } from "@/lib/http"
import { effectiveSettings, readSettings, updateSettings } from "@/lib/settings"

export const dynamic = "force-dynamic"

const view = () => {
  const e = effectiveSettings()
  const s = readSettings()
  return { apiUrl: e.apiUrl, apiKeyConfigured: !!e.apiKey, apiKeyPrefix: e.apiKey ? e.apiKey.slice(0, 6) + "…" : null, apiKeyFrom: e.apiKeyFrom, jitoTipLamports: e.jitoTipLamports, slippage: e.slippage, overrides: { apiUrl: !!s.apiUrl, jitoTipLamports: s.jitoTipLamports !== undefined, slippage: s.slippage !== undefined }, dir: BACKUP_DIR, file: SETTINGS_FILE }
}

/** GET /api/settings → the effective settings (the key itself is never returned). */
export async function GET() {
  return ok(view())
}

/** PUT /api/settings { apiKey?, apiUrl?, jitoTipLamports?, slippage? } → saved to _app/pumpfun-starter/settings.json; "" or null clears a field. */
export async function PUT(req: Request) {
  const b = await body<{ apiKey: string | null; apiUrl: string | null; jitoTipLamports: number | null; slippage: number | null }>(req)
  try {
    updateSettings({ apiKey: b.apiKey, apiUrl: b.apiUrl, jitoTipLamports: b.jitoTipLamports, slippage: b.slippage })
    return ok(view())
  } catch (e) {
    return fail(e)
  }
}
