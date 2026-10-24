import { balanceRows } from "@/lib/core/trading"
import { serverEnv } from "@/lib/env"
import { fail, ok } from "@/lib/http"

export const dynamic = "force-dynamic"

/**
 * GET /api/wallets/balances[?mint=…][&quoteMint=…] → { rows: [{ publicKey, native, sol, tokens, raw, quote? }] } for every
 * wallet in the folder (GET /api/sol/balances, one call per asset). `native` is the SOL balance (the same field the pons
 * starter fills with ETH, so the pages are shared); `tokens` is the coin's balance when `mint` is given. `quoteMint`
 * adds each wallet's balance of a custom pair's quote asset (USDC, a stock, …) as `quote`: what it can spend on that coin.
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams
  try {
    return ok(await balanceRows(serverEnv(), q.get("mint") || undefined, q.get("quoteMint") || undefined))
  } catch (e) {
    return fail(e)
  }
}
