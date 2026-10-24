import { fundDirect } from "@/lib/core/funding"
import { body, fail, num, ok, strings } from "@/lib/http"
import { trenchy } from "@/lib/settings"
import { walletStore } from "@/lib/wallets"

/**
 * POST /api/wallets/fund { publicKeys: string[], amount } → { results }: a plain SOL transfer from the ★ wallet to each
 * wallet (GET /api/sol/blockhash + POST /api/sol/send, confirmed). `amountSol` is the old name of `amount`. Refused
 * with 409 not_backed_up for a wallet whose file is missing; nothing is sent to it. lib/core/funding.ts.
 */
export async function POST(req: Request) {
  const b = await body<{ publicKeys: string[]; amount: number; amountSol: number }>(req)
  try {
    return ok(await fundDirect({ api: trenchy(), wallets: walletStore }, strings(b.publicKeys), num(b.amount ?? b.amountSol, 0)))
  } catch (e) {
    return fail(e)
  }
}
