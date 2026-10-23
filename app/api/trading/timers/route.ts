import { body, fail, num, ok, strings } from "@/lib/http"
import { addTimer, cancelTimer, clearFinished, listTimers } from "@/lib/timers"

export const dynamic = "force-dynamic"

/** GET /api/trading/timers[?mint=…] → the rules in server memory with their status. */
export async function GET(req: Request) {
  return ok({ now: Date.now(), timers: listTimers(new URL(req.url).searchParams.get("mint") || undefined) })
}

/** POST /api/trading/timers { mint, publicKeys, percent, minutes } → a new rule "at +minutes sell percent % of these wallets". */
export async function POST(req: Request) {
  const b = await body<{ mint: string; publicKeys: string[]; percent: number; minutes: number }>(req)
  if (typeof b.mint !== "string") return fail(new Error("mint is required"), 400)
  try {
    return ok(addTimer({ mint: b.mint, publicKeys: strings(b.publicKeys), percent: num(b.percent, 100), minutes: num(b.minutes, 5) }))
  } catch (e) {
    return fail(e, 400)
  }
}

/** DELETE /api/trading/timers?id=… cancels a pending rule (same as DELETE /api/trading/timers/:id); without id, forgets finished rules. */
export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id")
  if (!id) return ok({ cleared: clearFinished() })
  const rule = cancelTimer(id)
  return rule ? ok(rule) : fail(new Error("Timer not found"), 404)
}
