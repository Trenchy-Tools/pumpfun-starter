import { fail, ok } from "@/lib/http"
import { rewriteBackups } from "@/lib/wallets"

/** POST /api/wallets/rewrite-backups → { dir, files, restored, csvAdded }: idempotent export (restores missing files from wallets.csv). */
export async function POST() {
  try {
    return ok(rewriteBackups())
  } catch (e) {
    return fail(e)
  }
}
