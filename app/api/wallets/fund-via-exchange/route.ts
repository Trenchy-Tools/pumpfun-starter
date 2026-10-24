import { fundViaExchange } from "@/lib/core/funding"
import { body, fail, num, ok, strings } from "@/lib/http"
import { trenchy } from "@/lib/settings"
import type { TransferMode } from "@/lib/trenchy"
import { walletStore } from "@/lib/wallets"

/**
 * POST /api/wallets/fund-via-exchange { publicKeys (≤ 25), amountSol, mode: float|fixed|private, venue } → { batchId, legs }.
 * POST /api/transfer/batch opens one order per wallet and returns an unsigned deposit transaction from the funding
 * wallet for each; each one is checked (one SOL transfer, our payer, the deposit address, the amount), signed, sent
 * (POST /api/sol/send), recorded (POST /api/transfer/:id/sent). Follow a leg on GET /api/transfer/:id. lib/core/funding.ts.
 */
export async function POST(req: Request) {
  const b = await body<{ publicKeys: string[]; amount: number; amountSol: number; mode: string; venue: string }>(req)
  const mode = (["float", "fixed", "private"].includes(String(b.mode)) ? b.mode : "float") as TransferMode
  const venue = typeof b.venue === "string" && b.venue ? b.venue : "random"
  try {
    return ok(await fundViaExchange({ api: trenchy(), wallets: walletStore }, strings(b.publicKeys), num(b.amount ?? b.amountSol, 0), mode, venue))
  } catch (e) {
    return fail(e)
  }
}
