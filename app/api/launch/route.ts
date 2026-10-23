import { body, fail, ok } from "@/lib/http"
import { readLaunches, startLaunch } from "@/lib/launch"
import { readForm } from "./form"

export const dynamic = "force-dynamic"

/** GET /api/launch → launch records (newest first) from _app/pumpfun-starter/launches.json. */
export async function GET() {
  return ok({ launches: readLaunches().reverse() })
}

/** POST /api/launch (LaunchForm) → { id, events: "/api/launch/:id/events" }: starts the launch in the background. */
export async function POST(req: Request) {
  try {
    const rec = startLaunch(readForm(await body(req)))
    return ok({ id: rec.id, events: `/api/launch/${rec.id}/events`, launch: rec })
  } catch (e) {
    return fail(e, 400)
  }
}
