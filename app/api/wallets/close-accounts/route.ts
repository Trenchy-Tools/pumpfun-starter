import { closeEmpty } from "@/lib/core/funding"
import { body, fail, ok, strings } from "@/lib/http"
import { trenchy } from "@/lib/settings"
import { walletStore } from "@/lib/wallets"

/**
 * POST /api/wallets/close-accounts { publicKeys } → close every empty token account (GET /api/sol/balances?wallet=…&includeEmpty=true)
 * of each wallet; the funding wallet pays the fee and receives the rent (~0.002 SOL per account). lib/core/funding.ts.
 */
export async function POST(req: Request) {
  const b = await body<{ publicKeys: string[] }>(req)
  try {
    return ok(await closeEmpty({ api: trenchy(), wallets: walletStore }, strings(b.publicKeys)))
  } catch (e) {
    return fail(e)
  }
}
