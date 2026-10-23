import { body, fail, ok } from "@/lib/http"
import { fundPlan } from "@/lib/launch"
import { readForm } from "../form"

/** POST /api/launch/fund (LaunchForm) → top up every buyer in the plan from the funding wallet (direct transfers). Creates missing buyer wallets first (backed up). */
export async function POST(req: Request) {
  try {
    return ok({ results: await fundPlan(readForm(await body(req))) })
  } catch (e) {
    return fail(e)
  }
}
