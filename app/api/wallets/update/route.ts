import { body, fail, ok } from "@/lib/http"
import { isRole, updateWallet } from "@/lib/wallets"

/** POST /api/wallets/update { publicKey, label?, role? } → rename a wallet and/or set its role tag. The file is rewritten in place, the CSV line patched. */
export async function POST(req: Request) {
  const b = await body<{ publicKey: string; label: string; role: string }>(req)
  if (typeof b.publicKey !== "string" || !b.publicKey) return fail(new Error("publicKey is required"), 400)
  if (b.role !== undefined && !isRole(b.role)) return fail(new Error("role must be one of funding, bundle, sniper, holder, trader"), 400)
  try {
    return ok({ wallet: updateWallet(b.publicKey, { label: typeof b.label === "string" ? b.label : undefined, role: isRole(b.role) ? b.role : undefined }) })
  } catch (e) {
    return fail(e)
  }
}
