import { fail, ok } from "@/lib/http"
import { cancelTimer } from "@/lib/timers"

/** DELETE /api/trading/timers/:id → cancel a pending rule. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const rule = cancelTimer((await params).id)
  return rule ? ok(rule) : fail(new Error("Timer not found"), 404)
}
