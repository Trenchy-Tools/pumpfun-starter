import { BACKUP_DIR } from "@/lib/paths"
import { body, fail, ok } from "@/lib/http"
import { createWallets, isRole, listArchived, listWallets, mainWallet, missingFiles } from "@/lib/wallets"

export const dynamic = "force-dynamic"

/** GET /api/wallets → { dir, wallets, mainWallet, archived, missing }: the folder, read fresh. `mainWallet` is the ★ wallet's public key. */
export async function GET() {
  return ok({ dir: BACKUP_DIR, wallets: listWallets(), mainWallet: mainWallet()?.publicKey ?? null, archived: listArchived().length, missing: missingFiles() })
}

/**
 * POST /api/wallets { count?, label?, role? } → { dir, wallets: [{ …, path }], mainWallet }: `count` wallets labelled
 * "Wallet N" (or `label`), each file on disk before this answers. The first wallet ever created becomes ★. `role` is an
 * optional tag (bundle / sniper / holder / trader).
 */
export async function POST(req: Request) {
  const b = await body<{ count: number; role: string; label: string }>(req)
  try {
    const wallets = createWallets(Number(b.count) || 1, isRole(b.role) ? b.role : "trader", typeof b.label === "string" ? b.label : undefined)
    return ok({ dir: BACKUP_DIR, wallets, mainWallet: mainWallet()?.publicKey ?? null })
  } catch (e) {
    return fail(e, 409)
  }
}
