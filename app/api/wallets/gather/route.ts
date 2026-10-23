import { LAMPORTS_PER_SOL } from "@solana/web3.js"
import { body, fail, ok, strings } from "@/lib/http"
import { trenchy } from "@/lib/trenchy"
import { assertBackedUp, fundingWallet, keypairOf } from "@/lib/wallets"

const TX_FEE_LAMPORTS = 5000

/** POST /api/wallets/gather { publicKeys } → sweep every lamport but the fee from each wallet back to the funding wallet. */
export async function POST(req: Request) {
  const b = await body<{ publicKeys: string[] }>(req)
  const funding = fundingWallet()
  if (!funding) return fail(new Error("No funding wallet yet"), 400)
  const targets = strings(b.publicKeys).filter((pk) => pk !== funding.publicKey)
  if (!targets.length) return fail(new Error("publicKeys: at least one wallet (not the funding wallet)"), 400)
  try {
    const api = trenchy()
    const fundingPk = keypairOf(funding.publicKey).publicKey
    const sol = new Map((await api.balances(targets)).map((r) => [r.wallet, r.sol]))
    const results: Array<{ publicKey: string; recovered: number; signature?: string; error?: string }> = []
    for (const pk of targets) {
      const lamports = Math.round((sol.get(pk) ?? 0) * LAMPORTS_PER_SOL) - TX_FEE_LAMPORTS
      if (lamports <= 0) { results.push({ publicKey: pk, recovered: 0 }); continue }
      try {
        assertBackedUp(pk) // the source key is what moves the money: it must be on disk
        const signature = await api.transferSol(keypairOf(pk), fundingPk, 0, { lamports, confirm: false })
        results.push({ publicKey: pk, recovered: lamports / LAMPORTS_PER_SOL, signature })
      } catch (e) {
        results.push({ publicKey: pk, recovered: 0, error: e instanceof Error ? e.message : String(e) })
      }
    }
    return ok({ to: funding.publicKey, total: results.reduce((s, r) => s + r.recovered, 0), results })
  } catch (e) {
    return fail(e)
  }
}
