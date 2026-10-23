import { body, fail, ok, strings } from "@/lib/http"
import { exportKeys } from "@/lib/wallets"

/**
 * POST /api/wallets/export { publicKeys } → { wallets: [{ publicKey, privateKey, label, file }] }: the secret keys, read
 * from the files, for the Key button and Export keys. Local, single-user app: there is no auth layer in front of this.
 */
export async function POST(req: Request) {
  const b = await body<{ publicKeys: string[] }>(req)
  const targets = strings(b.publicKeys)
  if (!targets.length) return fail(new Error("publicKeys: at least one wallet"), 400)
  try {
    return ok({ wallets: exportKeys(targets) })
  } catch (e) {
    return fail(e)
  }
}
