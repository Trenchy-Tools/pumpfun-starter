import { fail, sse } from "@/lib/http"
import { backfillMint, followMint, onTrade } from "@/lib/trading"

export const dynamic = "force-dynamic"

/**
 * GET /api/trading/trades?mint=… → server-sent events: the trades seen so far, then the coin's history from
 * GET /api/sol/trades (the dev buy and the bundle included) as a second `initial`, then live trades from the websocket.
 */
export async function GET(req: Request) {
  const mint = new URL(req.url).searchParams.get("mint")
  if (!mint || mint.length < 32) return fail(new Error("mint is required"), 400)
  return sse(req, (send) => {
    send({ type: "initial", trades: followMint(mint) })
    void backfillMint(mint).then((trades) => send({ type: "initial", trades: [...trades] }))
    return onTrade((trade) => { if (trade.mint === mint) send({ type: "trade", trade }) })
  })
}
