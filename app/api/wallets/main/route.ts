import { body, fail, ok } from "@/lib/http"
import { setMainWallet } from "@/lib/wallets"

/** POST /api/wallets/main { publicKey } → make that wallet the ★ (saved as `mainWallet` in _app/pumpfun-starter/settings.json). */
export async function POST(req: Request) {
  const b = await body<{ publicKey: string }>(req)
  if (typeof b.publicKey !== "string" || !b.publicKey) return fail(new Error("publicKey is required"), 400)
  try {
    return ok({ mainWallet: setMainWallet(b.publicKey) })
  } catch (e) {
    return fail(e)
  }
}
