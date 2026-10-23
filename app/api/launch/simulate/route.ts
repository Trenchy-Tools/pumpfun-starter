import { body, fail, ok } from "@/lib/http"
import { simulateLaunch } from "@/lib/launch"
import { readForm } from "../form"

/** POST /api/launch/simulate (LaunchForm) → checks + the API's POST /api/sol/simulate answer for the create + dev buy. Nothing is sent. */
export async function POST(req: Request) {
  try {
    return ok(await simulateLaunch(readForm(await body(req))))
  } catch (e) {
    return fail(e)
  }
}
