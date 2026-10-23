import { BACKUP_DIR } from "@/lib/paths"
import { ok } from "@/lib/http"
import { ApiError, trenchy } from "@/lib/trenchy"
import { fundingWallet, isBackedUp, listWallets } from "@/lib/wallets"

export const dynamic = "force-dynamic"

/**
 * GET /api/settings/status → the top-bar pills: API key state (GET /api/me), the ★ wallet + SOL (`funding`), backup folder.
 * Never fails: every problem is reported inside the answer.
 */
export async function GET() {
  const api = trenchy()
  const apiState: { configured: boolean; connected: boolean; url: string; keyPrefix?: string; error?: string; code?: string } = { configured: api.configured, connected: false, url: api.url }
  const funding = fundingWallet()
  let sol: number | null = null
  if (api.configured) {
    try {
      const me = await api.me()
      apiState.connected = true
      apiState.keyPrefix = me.keyPrefix
      if (funding) sol = await api.solBalance(funding.publicKey).catch(() => null)
    } catch (e) {
      apiState.error = e instanceof Error ? e.message : String(e)
      if (e instanceof ApiError) apiState.code = e.code
    }
  }
  return ok({ api: apiState, funding: funding ? { publicKey: funding.publicKey, label: funding.label, sol, backedUp: isBackedUp(funding.publicKey) } : null, backups: { dir: BACKUP_DIR, wallets: listWallets().length } })
}
