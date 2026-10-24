/**
 * Runs before every app/api/* route. Local mode: passes straight through. Demo mode (DEMO_MODE=1, the hosted app):
 * answers 404 { code: "demo_mode" } so no route handler that reads or writes wallets, launches, timers, settings,
 * vanity keys or IPFS ever runs on the shared server. The pages still load; in demo mode they talk to the browser
 * engine (lib/browser/engine.ts) instead of these routes.
 */
import { NextResponse } from "next/server"
import { demoGuard } from "@/lib/http"

export function proxy() {
  return demoGuard() ?? NextResponse.next()
}

export const config = { matcher: "/api/:path*" }
