import { fail, ok } from "@/lib/http"
import { trenchy } from "@/lib/trenchy"

export const dynamic = "force-dynamic"

/**
 * GET /api/launch/pairs[?refresh=1] → GET /api/sol/pairs, cached 10 minutes on this server: the quote assets a coin
 * can be paired with (SOL, USDC, xStocks, WBTC, PUMP, …) with symbol, name, decimals and `kind` for grouping.
 */
export async function GET(req: Request) {
  try {
    return ok(await trenchy().pairs(new URL(req.url).searchParams.get("refresh") === "1"))
  } catch (e) {
    return fail(e)
  }
}
