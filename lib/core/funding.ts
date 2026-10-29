/**
 * Moving SOL between the app's own wallets, shared by local mode (the /api/wallets/* routes) and demo mode (the browser
 * engine). Every source key must pass the backup rule before anything is signed. No node imports.
 *
 *   fundDirect       ★ → each wallet, plain transfers (GET /api/sol/blockhash + POST /api/sol/send, confirmed)
 *   fundViaExchange  each wallet paid by an exchange hot wallet (POST /api/transfer/batch → verify + sign the deposit)
 *   gather           every lamport but the fee from each wallet back to ★
 *   closeEmpty       close empty token accounts; ★ pays the fee and receives the rent
 */
import { LAMPORTS_PER_SOL, PublicKey, TransactionInstruction } from "@solana/web3.js"
import { Buffer } from "buffer"
import { ApiError, isLegError, Trenchy, type TransferMode } from "../trenchy"
import type { WalletStore } from "./env"
import { RouteError } from "./errors"

type Ctx = { api: Trenchy; wallets: WalletStore }

/**
 * A plain SOL transfer from the ★ wallet to each wallet. All or nothing on the backup rule: one wallet that is not
 * backed up refuses the whole request (409 not_backed_up) and nothing is sent.
 */
export async function fundDirect({ api, wallets }: Ctx, targets: string[], amount: number) {
  if (!targets.length) throw new RouteError("publicKeys: at least one wallet")
  if (!(amount > 0)) throw new RouteError("amount must be greater than zero")
  const funding = wallets.main()
  if (!funding) throw new RouteError("No ★ wallet yet: create or import one first")
  for (const pk of [funding.publicKey, ...targets]) wallets.assertBackedUp(pk)
  const fundingKp = wallets.keypairOf(funding.publicKey)
  const results: Array<{ publicKey: string; signature?: string; error?: string }> = []
  for (const pk of targets) {
    try {
      results.push({ publicKey: pk, signature: await api.transferSol(fundingKp, new PublicKey(pk), amount) })
    } catch (e) {
      results.push({ publicKey: pk, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return { amountSol: amount, results }
}

export const EXPLAIN = "Each wallet is paid by an exchange hot wallet instead of by your funding wallet. Reduces on-chain linkability."

export type FundLeg = {
  publicKey: string; transferId?: string; status: string; route?: string; mode?: string | null; venue?: string | null; venueHonoured?: boolean
  deposit?: { address: string; amount: number; deadline?: string } | null; signature?: string; receipt?: string; error?: string; code?: string
}

/**
 * POST /api/transfer/batch opens one order per wallet and returns an unsigned deposit transaction from the ★ wallet
 * for each; each one is checked (exactly one SOL transfer, our payer, the deposit address, the amount), signed, sent
 * (POST /api/sol/send, simulated first) and recorded (POST /api/transfer/:id/sent). Follow a leg on GET /api/transfer/:id.
 */
export async function fundViaExchange({ api, wallets }: Ctx, targets: string[], amountSol: number, mode: TransferMode, venue: string) {
  if (!targets.length || targets.length > 25) throw new RouteError("publicKeys: 1 to 25 wallets")
  if (!(amountSol > 0)) throw new RouteError("amountSol must be greater than zero")
  const funding = wallets.main()
  if (!funding) throw new RouteError("No funding wallet yet: create or import one first")
  for (const pk of [funding.publicKey, ...targets]) wallets.assertBackedUp(pk)
  const fundingKp = wallets.keypairOf(funding.publicKey)
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
  return { batchId: batch.batchId, explain: EXPLAIN, legs }
}

const TX_FEE_LAMPORTS = 5000

/** Sweep every lamport but the fee from each wallet back to the ★ wallet (the source key must be backed up). */
export async function gather(ctx: Ctx, publicKeys: string[]) {
  const funding = ctx.wallets.main()
  if (!funding) throw new RouteError("No funding wallet yet")
  const targets = publicKeys.filter((pk) => pk !== funding.publicKey)
  if (!targets.length) throw new RouteError("publicKeys: at least one wallet (not the funding wallet)")
  return sendDirect(ctx, targets, funding.publicKey, "max")
}

/**
 * Each wallet → `to` (any address: ★, another wallet of the folder, or an outside address): `amount` SOL, or "max" =
 * the whole balance minus the 5,000-lamport fee. Plain transfers signed by each source (GET /api/sol/blockhash →
 * POST /api/sol/send). A source that is not backed up refuses before anything is sent.
 */
export async function sendDirect({ api, wallets }: Ctx, publicKeys: string[], to: string, amount: number | "max") {
  for (const pk of publicKeys) wallets.assertBackedUp(pk) // the source keys move the money: all backed up, or nothing is sent
  const toPk = new PublicKey(to)
  const sol = new Map((await api.balances(publicKeys)).map((r) => [r.wallet, r.sol]))
  const results: Array<{ publicKey: string; recovered: number; signature?: string; error?: string; skipped?: string }> = []
  for (const pk of publicKeys) {
    if (pk === to) { results.push({ publicKey: pk, recovered: 0, skipped: "is the destination" }); continue }
    const balance = Math.round((sol.get(pk) ?? 0) * LAMPORTS_PER_SOL)
    const lamports = amount === "max" ? balance - TX_FEE_LAMPORTS : Math.round(amount * LAMPORTS_PER_SOL)
    if (lamports <= 0) { results.push({ publicKey: pk, recovered: 0, skipped: `holds ${(balance / LAMPORTS_PER_SOL).toFixed(6)} SOL, not even the fee` }); continue }
    if (lamports + TX_FEE_LAMPORTS > balance) { results.push({ publicKey: pk, recovered: 0, error: `holds ${(balance / LAMPORTS_PER_SOL).toFixed(6)} SOL; ${(lamports / LAMPORTS_PER_SOL).toFixed(6)} + the fee is more than that (use Max)` }); continue }
    try {
      const signature = await api.transferSol(wallets.keypairOf(pk), toPk, 0, { lamports, confirm: false })
      results.push({ publicKey: pk, recovered: lamports / LAMPORTS_PER_SOL, signature })
    } catch (e) {
      results.push({ publicKey: pk, recovered: 0, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return { to, total: results.reduce((s, r) => s + r.recovered, 0), results }
}

/** SPL Token / Token-2022 `CloseAccount` (instruction 9): account, destination (gets the rent), owner (signs). */
const closeAccountIx = (account: PublicKey, destination: PublicKey, owner: PublicKey, program: PublicKey) =>
  new TransactionInstruction({ programId: program, keys: [{ pubkey: account, isSigner: false, isWritable: true }, { pubkey: destination, isSigner: false, isWritable: true }, { pubkey: owner, isSigner: true, isWritable: false }], data: Buffer.from([9]) })

/**
 * Close every empty token account (GET /api/sol/balances?wallet=…&includeEmpty=true) of each wallet; the ★ wallet pays
 * the fee and receives the rent (~0.002 SOL per account).
 */
export async function closeEmpty({ api, wallets }: Ctx, targets: string[]) {
  if (!targets.length) throw new RouteError("publicKeys: at least one wallet")
  const funding = wallets.main()
  if (!funding) throw new RouteError("No funding wallet yet")
  wallets.assertBackedUp(funding.publicKey)
  const fundingKp = wallets.keypairOf(funding.publicKey)
  const results: Array<{ publicKey: string; closed: number; error?: string }> = []
  for (const pk of targets) {
    try {
      const kp = wallets.keypairOf(pk)
      const empty = (await api.tokenAccounts(pk, true)).filter((a) => a.raw === "0")
      let closed = 0
      for (let i = 0; i < empty.length; i += 10) {
        const chunk = empty.slice(i, i + 10)
        await api.sendInstructions(fundingKp, chunk.map((a) => closeAccountIx(new PublicKey(a.account), fundingKp.publicKey, kp.publicKey, new PublicKey(a.program))), kp.publicKey.equals(fundingKp.publicKey) ? [] : [kp], false)
        closed += chunk.length
      }
      results.push({ publicKey: pk, closed })
    } catch (e) {
      results.push({ publicKey: pk, closed: 0, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return { totalClosed: results.reduce((s, r) => s + r.closed, 0), results }
}
