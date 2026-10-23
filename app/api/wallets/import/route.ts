import { BACKUP_DIR } from "@/lib/paths"
import { body, fail, ok } from "@/lib/http"
import { importWallet, isRole, mainWallet } from "@/lib/wallets"

/** POST /api/wallets/import { privateKey (base58), label?, role? } → the wallet + its file path. Becomes ★ when it is the first wallet. */
export async function POST(req: Request) {
  const b = await body<{ privateKey: string; role: string; label: string }>(req)
  if (typeof b.privateKey !== "string" || !b.privateKey.trim()) return fail(new Error("privateKey (base58) is required"), 400)
  try {
    return ok({ dir: BACKUP_DIR, wallet: importWallet(b.privateKey, isRole(b.role) ? b.role : "trader", typeof b.label === "string" ? b.label : undefined), mainWallet: mainWallet()?.publicKey ?? null })
  } catch (e) {
    return fail(e, 400)
  }
}
