import { ok } from "@/lib/http"
import { jobStatus } from "@/lib/vanity"

export const dynamic = "force-dynamic"

/** GET /api/vanity/status → the running (or last) API job: attempts, expectedAttempts, rate, found. */
export async function GET() {
  return ok(jobStatus())
}
