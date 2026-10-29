import { simulateLaunch } from "@/lib/core/launch"
import { serverEnv } from "@/lib/env"
import { body, fail, ok } from "@/lib/http"
import { readForm } from "../form"

/**
 * POST /api/launch/simulate (LaunchForm) → checks + the API's POST /api/sol/simulate answer for the create + dev buy,
 * plus `calls`: every request this made to the TrenchyTools API (the dry run's trace). Nothing is sent.
 */
export async function POST(req: Request) {
  const env = serverEnv()
  env.api.beginTrace()
  try {
    const r = await simulateLaunch(env, readForm(await body(req)))
    return ok({ ...r, calls: env.api.endTrace() })
  } catch (e) {
    return fail(e)
  }
}
