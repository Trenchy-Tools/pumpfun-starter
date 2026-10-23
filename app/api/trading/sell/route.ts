import { body, fail, num, ok } from "@/lib/http"
import { sell } from "@/lib/trading"

/** POST /api/trading/sell { publicKey, mint, percent } → one wallet sells (trade-local sell "NN%" pool auto → sign → send → tx). */
export async function POST(req: Request) {
  const b = await body<{ publicKey: string; mint: string; percent: number }>(req)
  if (typeof b.publicKey !== "string" || typeof b.mint !== "string") return fail(new Error("publicKey and mint are required"), 400)
  try {
    return ok(await sell(b.publicKey, b.mint, num(b.percent, 100)))
  } catch (e) {
    return fail(e)
  }
}
