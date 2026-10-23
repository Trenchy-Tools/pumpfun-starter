import { LAMPORTS_PER_SOL } from "@solana/web3.js"
import { body, fail, num, ok, strings } from "@/lib/http"
import { ApiError, Trenchy, isLegError, trenchy, type TransferMode } from "@/lib/trenchy"
import { assertBackedUp, fundingWallet, keypairOf } from "@/lib/wallets"

export const EXPLAIN = "Each wallet is paid by an exchange hot wallet instead of by your funding wallet. Reduces on-chain linkability."

export type FundLeg = {
  publicKey: string; transferId?: string; status: string; route?: string; mode?: string | null; venue?: string | null; venueHonoured?: boolean
  deposit?: { address: string; amount: number; deadline?: string } | null; signature?: string; receipt?: string; error?: string; code?: string
}

/**
 * POST /api/wallets/fund-via-exchange { publicKeys (≤ 25), amountSol, mode: float|fixed|private, venue } → { batchId, legs }.
 * POST /api/transfer/batch opens one order per wallet and returns an unsigned deposit transaction from the funding
 * wallet for each; this handler checks each one (one SOL transfer, our payer, the deposit address, the amount),
 * signs it, sends it (POST /api/sol/send), records it (POST /api/transfer/:id/sent). Follow a leg on GET /api/transfer/:id.
 */
export async function POST(req: Request) {
  const b = await body<{ publicKeys: string[]; amount: number; amountSol: number; mode: string; venue: string }>(req)
  const targets = strings(b.publicKeys)
  const amountSol = num(b.amount ?? b.amountSol, 0)
  const mode = (["float", "fixed", "private"].includes(String(b.mode)) ? b.mode : "float") as TransferMode
  const venue = typeof b.venue === "string" && b.venue ? b.venue : "random"
  if (!targets.length || targets.length > 25) return fail(new Error("publicKeys: 1 to 25 wallets"), 400)
  if (!(amountSol > 0)) return fail(new Error("amountSol must be greater than zero"), 400)
  try {
    const funding = fundingWallet()
    if (!funding) return fail(new Error("No funding wallet yet: create or import one first"), 400)
    for (const pk of [funding.publicKey, ...targets]) assertBackedUp(pk)
    const fundingKp = keypairOf(funding.publicKey)
    const api = trenchy()
    const batch = await api.createTransferBatch({ from: { chain: "sol", wallet: funding.publicKey }, to: targets.map((address) => ({ chain: "sol", address, amount: amountSol })), mode, venue })

    const legs: FundLeg[] = []
    for (const [i, publicKey] of targets.entries()) {
      const leg = batch.legs[i]
      if (!leg) { legs.push({ publicKey, status: "failed", error: "the API returned no leg for this wallet" }); continue }
      if (isLegError(leg)) { legs.push({ publicKey, status: "failed", error: leg.error, code: leg.code }); continue }
      const out: FundLeg = { publicKey, transferId: leg.transferId, status: leg.status, route: leg.route, mode: leg.mode ?? null, venue: leg.venue ?? null, venueHonoured: leg.venueHonoured, deposit: leg.deposit ? { address: leg.deposit.address, amount: leg.deposit.amount, deadline: leg.deposit.deadline } : null }
      try {
        if (!leg.deposit || !leg.transaction) throw new Error(`the order is still ${leg.status}; no deposit address yet`)
        if (leg.deposit.amount > amountSol * 1.05) throw new Error(`deposit amount ${leg.deposit.amount} SOL is above the ${amountSol} SOL asked for; refusing`)
        const tx = Trenchy.depositTx(leg)
        Trenchy.checkDeposit(tx, fundingKp.publicKey, leg.deposit.address, Math.round(leg.deposit.amount * LAMPORTS_PER_SOL))
        tx.sign([fundingKp])
        const { signature } = await api.send(tx, { skipPreflight: false }) // simulated first: an empty funding wallet fails here with the reason
        out.signature = signature
        await api.transferSent(leg.transferId, signature).catch(() => {})
        const s = await api.transferStatus(leg.transferId).catch(() => null)
        if (s) { out.status = s.status; out.receipt = s.receipt; out.venue = s.venue ?? out.venue }
      } catch (e) {
        out.status = "failed"
        out.error = e instanceof Error ? e.message : String(e)
        if (e instanceof ApiError) out.code = e.code
      }
      legs.push(out)
    }
    return ok({ batchId: batch.batchId, explain: EXPLAIN, legs })
  } catch (e) {
    return fail(e)
  }
}
