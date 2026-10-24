import { readForm as parse } from "@/lib/core/form"
import type { LaunchForm } from "@/lib/launch"
import { effectiveSettings } from "@/lib/settings"

/** The Launch page's JSON → a LaunchForm with defaults and bounds (lib/core/form.ts; the browser engine uses the same). */
export function readForm(b: Record<string, unknown>): LaunchForm {
  return parse(b, effectiveSettings().slippage)
}
