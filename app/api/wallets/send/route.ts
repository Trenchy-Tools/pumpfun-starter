import { sendDirect } from "@/lib/core/funding"
import { body, fail, ok, strings } from "@/lib/http"
import { trenchy } from "@/lib/settings"
import { walletStore } from "@/lib/wallets"

/**
 * POST /api/wallets/send { publicKeys, to, amount } → { to, total, results }: a plain SOL transfer from each selected
 * wallet to `to` (any address). `amount` is SOL, or "max" for the whole balance minus the fee. Signed by each source,
 * sent with POST /api/sol/send. 409 not_backed_up when a source's key file is missing; nothing is sent then.
 */
export async function POST(req: Request) {
  const b = await body<{ publicKeys: string[]; to: string; amount: number | string }>(req)
  const from = strings(b.publicKeys)
  if (!from.length) return fail(new Error("publicKeys: at least one wallet"), 400)
  if (typeof b.to !== "string" || b.to.length < 32) return fail(new Error("to: a Solana address"), 400)
  const amount = b.amount === "max" ? "max" : Number(b.amount)
  if (amount !== "max" && !(amount > 0)) return fail(new Error('amount: SOL, or "max"'), 400)
  try {
    return ok(await sendDirect({ api: trenchy(), wallets: walletStore }, from, b.to, amount))
  } catch (e) {
    return fail(e)
  }
}
