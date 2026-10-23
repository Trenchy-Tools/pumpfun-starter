import { VANITY_POOL_FILE } from "@/lib/paths"
import { ok } from "@/lib/http"
import { pool } from "@/lib/vanity"

export const dynamic = "force-dynamic"

/** GET /api/vanity/pool → every key in vanity-pool.json (without secrets), newest first. */
export async function GET() {
  const entries = pool()
  return ok({ file: VANITY_POOL_FILE, available: entries.filter((e) => e.status === "available").length, used: entries.filter((e) => e.status === "used").length, entries })
}
