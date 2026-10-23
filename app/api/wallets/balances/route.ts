import { fail, ok } from "@/lib/http"
import { trenchy } from "@/lib/trenchy"
import { listWallets } from "@/lib/wallets"

export const dynamic = "force-dynamic"

/**
 * GET /api/wallets/balances[?mint=…][&quoteMint=…] → { rows: [{ publicKey, native, sol, tokens, raw, quote? }] } for every
 * wallet in the folder (GET /api/sol/balances, one call per asset). `native` is the SOL balance (the same field the pons
 * starter fills with ETH, so the pages are shared); `tokens` is the coin's balance when `mint` is given. `quoteMint`
 * adds each wallet's balance of a custom pair's quote asset (USDC, a stock, …) as `quote`: what it can spend on that coin.
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams
  const mint = q.get("mint") || undefined
  const quoteMint = q.get("quoteMint") || undefined
  const wallets = listWallets()
  if (!wallets.length) return ok({ rows: [] })
  try {
    const api = trenchy()
    const keys = wallets.map((w) => w.publicKey)
    const [rows, quotes] = await Promise.all([api.balances(keys, mint), quoteMint ? api.balances(keys, quoteMint) : Promise.resolve(null)])
    const quoteBy = new Map((quotes ?? []).map((r) => [r.wallet, r.token?.balance ?? 0]))
    return ok({ mint: mint ?? null, quoteMint: quoteMint ?? null, rows: rows.map((r) => ({ publicKey: r.wallet, native: r.sol, sol: r.sol, tokens: r.token?.balance ?? 0, raw: r.token?.raw ?? "0", ...(quoteMint ? { quote: quoteBy.get(r.wallet) ?? 0 } : {}) })) })
  } catch (e) {
    return fail(e)
  }
}
