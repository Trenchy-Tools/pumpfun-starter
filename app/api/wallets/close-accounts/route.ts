import { PublicKey, TransactionInstruction } from "@solana/web3.js"
import { body, fail, ok, strings } from "@/lib/http"
import { trenchy } from "@/lib/trenchy"
import { assertBackedUp, fundingWallet, keypairOf } from "@/lib/wallets"

/** SPL Token / Token-2022 `CloseAccount` (instruction 9): account, destination (gets the rent), owner (signs). */
const closeAccountIx = (account: PublicKey, destination: PublicKey, owner: PublicKey, program: PublicKey) =>
  new TransactionInstruction({ programId: program, keys: [{ pubkey: account, isSigner: false, isWritable: true }, { pubkey: destination, isSigner: false, isWritable: true }, { pubkey: owner, isSigner: true, isWritable: false }], data: Buffer.from([9]) })

/**
 * POST /api/wallets/close-accounts { publicKeys } → close every empty token account (GET /api/sol/balances?wallet=…&includeEmpty=true)
 * of each wallet; the funding wallet pays the fee and receives the rent (~0.002 SOL per account).
 */
export async function POST(req: Request) {
  const b = await body<{ publicKeys: string[] }>(req)
  const targets = strings(b.publicKeys)
  if (!targets.length) return fail(new Error("publicKeys: at least one wallet"), 400)
  const funding = fundingWallet()
  if (!funding) return fail(new Error("No funding wallet yet"), 400)
  try {
    assertBackedUp(funding.publicKey)
    const fundingKp = keypairOf(funding.publicKey)
    const api = trenchy()
    const results: Array<{ publicKey: string; closed: number; error?: string }> = []
    for (const pk of targets) {
      try {
        const kp = keypairOf(pk)
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
    return ok({ totalClosed: results.reduce((s, r) => s + r.closed, 0), results })
  } catch (e) {
    return fail(e)
  }
}
