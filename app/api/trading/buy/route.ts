import { body, fail, num, ok } from "@/lib/http"
import { buy } from "@/lib/trading"

/**
 * POST /api/trading/buy { publicKey, mint, amount, partialFill? } → one wallet buys (trade-local buy pool auto → sign → send → tx).
 * `amount` is in the coin's quote asset (SOL for SOL coins; USDC / the stock / the coin on a custom pair). `sol` is the
 * old name of the same field. `partialFill` is for Mayhem coins: a buy past the remaining supply takes what is left.
 */
export async function POST(req: Request) {
  const b = await body<{ publicKey: string; mint: string; amount: number; sol: number; partialFill: boolean }>(req)
  const amount = num(b.amount ?? b.sol, 0)
  if (typeof b.publicKey !== "string" || typeof b.mint !== "string") return fail(new Error("publicKey and mint are required"), 400)
  if (!(amount > 0)) return fail(new Error("amount must be greater than zero"), 400)
  try {
    return ok(await buy(b.publicKey, b.mint, amount, undefined, b.partialFill === true))
  } catch (e) {
    return fail(e)
  }
}
