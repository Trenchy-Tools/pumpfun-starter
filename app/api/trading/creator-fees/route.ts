import { body, fail, ok } from "@/lib/http"
import { collectCreatorFees, creatorFees } from "@/lib/trading"

export const dynamic = "force-dynamic"

/** GET /api/trading/creator-fees?mint=… → unclaimed creator fees of the coin's creator (GET /api/sol/creator-fees). */
export async function GET(req: Request) {
  const mint = new URL(req.url).searchParams.get("mint")
  if (!mint) return fail(new Error("mint is required"), 400)
  try {
    return ok(await creatorFees(mint))
  } catch (e) {
    return fail(e)
  }
}

/** POST /api/trading/creator-fees { mint } → claim them (trade-local collectCreatorFee → sign → send → tx). */
export async function POST(req: Request) {
  const b = await body<{ mint: string }>(req)
  if (typeof b.mint !== "string") return fail(new Error("mint is required"), 400)
  try {
    return ok(await collectCreatorFees(b.mint))
  } catch (e) {
    return fail(e)
  }
}
