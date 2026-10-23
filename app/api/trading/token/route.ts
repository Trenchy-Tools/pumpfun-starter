import { fail, ok } from "@/lib/http"
import { tokenInfo } from "@/lib/trading"

export const dynamic = "force-dynamic"

/**
 * GET /api/trading/token?mint=… → GET /api/sol/token/:mint: the coin's quote asset (`quote`: SOL, or USDC / a stock /
 * a coin on a custom pair), `mayhem.enabled`, `holderReward`, `creatorFeeBps`, `venue`. The Trading and Wallets pages
 * label amounts with `quote.symbol` and show the Mayhem badge from it.
 */
export async function GET(req: Request) {
  const mint = new URL(req.url).searchParams.get("mint") || ""
  if (mint.length < 32) return fail(new Error("mint is required"), 400)
  try {
    return ok(await tokenInfo(mint))
  } catch (e) {
    return fail(e)
  }
}
