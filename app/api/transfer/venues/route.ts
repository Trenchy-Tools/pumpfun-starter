import { fail, ok } from "@/lib/http"
import { trenchy } from "@/lib/trenchy"

export const dynamic = "force-dynamic"

/** GET /api/transfer/venues → the API's GET /api/transfer/venues (which exchange venues are open right now). */
export async function GET() {
  try {
    return ok(await trenchy().transferVenues())
  } catch (e) {
    return fail(e)
  }
}
