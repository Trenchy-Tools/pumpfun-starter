import { PublicKey } from "@solana/web3.js"
import { body, fail, num, ok, strings } from "@/lib/http"
import { trenchy } from "@/lib/trenchy"
import { assertBackedUp, fundingWallet, keypairOf } from "@/lib/wallets"

/**
 * POST /api/wallets/fund { publicKeys: string[], amount } → { results }: a plain SOL transfer from the ★ wallet to each
 * wallet (GET /api/sol/blockhash + POST /api/sol/send, confirmed). `amountSol` is the old name of `amount`. Refused
 * with 409 not_backed_up for a wallet whose file is missing; nothing is sent to it.
 */
export async function POST(req: Request) {
  const b = await body<{ publicKeys: string[]; amount: number; amountSol: number }>(req)
  const targets = strings(b.publicKeys)
  const amount = num(b.amount ?? b.amountSol, 0)
  if (!targets.length) return fail(new Error("publicKeys: at least one wallet"), 400)
  if (!(amount > 0)) return fail(new Error("amount must be greater than zero"), 400)
  try {
    const funding = fundingWallet()
    if (!funding) return fail(new Error("No ★ wallet yet: create or import one first"), 400)
    for (const pk of [funding.publicKey, ...targets]) assertBackedUp(pk) // all or nothing: one missing file refuses the whole request
    const fundingKp = keypairOf(funding.publicKey)
    const api = trenchy()
    const results: Array<{ publicKey: string; signature?: string; error?: string }> = []
    for (const pk of targets) {
      try {
        results.push({ publicKey: pk, signature: await api.transferSol(fundingKp, new PublicKey(pk), amount) })
      } catch (e) {
        results.push({ publicKey: pk, error: e instanceof Error ? e.message : String(e) })
      }
    }
    return ok({ amountSol: amount, results })
  } catch (e) {
    return fail(e)
  }
}
