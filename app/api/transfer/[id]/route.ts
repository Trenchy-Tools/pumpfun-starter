import { fail, ok } from "@/lib/http"
import { trenchy } from "@/lib/settings"

export const dynamic = "force-dynamic"

/** GET /api/transfer/:id → the API's GET /api/transfer/:id (status, depositHash, payoutHash, receipt, help). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return ok(await trenchy().transferStatus((await params).id))
  } catch (e) {
    return fail(e)
  }
}
