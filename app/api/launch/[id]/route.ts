import { fail, ok } from "@/lib/http"
import { readLaunches } from "@/lib/launch"

export const dynamic = "force-dynamic"

/** GET /api/launch/:id → the launch record. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const rec = readLaunches().find((l) => l.id === id)
  return rec ? ok(rec) : fail(new Error("Launch not found"), 404)
}
