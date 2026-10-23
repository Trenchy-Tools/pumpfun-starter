import { fail, sse } from "@/lib/http"
import { followMint, onTrade } from "@/lib/trading"

export const dynamic = "force-dynamic"

/** GET /api/trading/trades?mint=… → server-sent events relaying the API websocket (subscribeTokenTrade): the trades seen so far, then live. */
export async function GET(req: Request) {
  const mint = new URL(req.url).searchParams.get("mint")
  if (!mint || mint.length < 32) return fail(new Error("mint is required"), 400)
  return sse(req, (send) => {
    send({ type: "initial", trades: followMint(mint) })
    return onTrade((trade) => { if (trade.mint === mint) send({ type: "trade", trade }) })
  })
}
