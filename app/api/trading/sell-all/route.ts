import { body, fail, num, ok, strings } from "@/lib/http"
import { sellAll } from "@/lib/trading"

/** POST /api/trading/sell-all { publicKeys, mint, percent } → sequential sells across the selection. */
export async function POST(req: Request) {
  const b = await body<{ publicKeys: string[]; mint: string; percent: number }>(req)
  const wallets = strings(b.publicKeys)
  if (!wallets.length || typeof b.mint !== "string") return fail(new Error("publicKeys and mint are required"), 400)
  try {
    return ok({ results: await sellAll(wallets, b.mint, num(b.percent, 100)) })
  } catch (e) {
    return fail(e)
  }
}
