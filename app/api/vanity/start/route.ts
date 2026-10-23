import { body, fail, ok } from "@/lib/http"
import { startJob } from "@/lib/vanity"

/** POST /api/vanity/start { suffix, prefix, caseSensitive } → the job (POST /api/sol/vanity, followed in the background). */
export async function POST(req: Request) {
  const b = await body<{ suffix: string; prefix: string; caseSensitive: boolean }>(req)
  try {
    return ok(await startJob({ suffix: typeof b.suffix === "string" ? b.suffix : "", prefix: typeof b.prefix === "string" ? b.prefix : "", caseSensitive: b.caseSensitive !== false }))
  } catch (e) {
    return fail(e, 400)
  }
}
