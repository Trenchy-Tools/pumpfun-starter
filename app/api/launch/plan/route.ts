import { body, fail, ok } from "@/lib/http"
import { fundingPlan } from "@/lib/launch"
import { readForm } from "../form"

export const dynamic = "force-dynamic"

/**
 * POST /api/launch/plan (LaunchForm) → the funding plan.
 *   SOL coin: per wallet buy + 0.5 % fee + 0.01 reserve; dev: + tip + LUT rent. No API call.
 *   Custom pair (quoteMint): each wallet's quote-asset balance is read (GET /api/sol/balances?wallets=…&mint=<quote>);
 *     `shortfalls` lists "send X SYMBOL to …" per wallet and `ok` is false until they hold it. SOL rows keep the fee reserve.
 *   Mayhem / holder rewards / creator fee: judged by the API (a create built with a throwaway mint, nothing sent); a
 *     refusal such as `mayhem_quote_not_allowed` is returned verbatim in `refusal`.
 */
export async function POST(req: Request) {
  try {
    return ok(await fundingPlan(readForm(await body(req))))
  } catch (e) {
    return fail(e)
  }
}
