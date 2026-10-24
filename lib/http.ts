/**
 * Route-handler helpers. Every error leaves the server in the same shape the API uses: { error, code?, hint?, docs? }.
 * An ApiError from lib/trenchy.ts is passed through with its status; a NotBackedUpError is 409 not_backed_up (the
 * shape itself is lib/core/errors.ts, shared with the browser engine of demo mode).
 *
 * Demo mode (DEMO_MODE=1, the hosted app): `demoGuard` answers every app/api/* route with 404 demo_mode before the
 * handler runs, so the hosted container never touches a wallet folder. It is applied once, to every route, by
 * proxy.ts at the project root.
 */
import { DEMO_MODE_BODY, errorBody } from "./core/errors"

export { num, strings } from "./core/form"

export const ok = (data: unknown, status = 200) => Response.json(data, { status })

export function fail(err: unknown, status?: number): Response {
  const r = errorBody(err, status)
  return Response.json(r.body, { status: r.status })
}

/** True when this server runs as the hosted demo (DEMO_MODE=1): it keeps no state and serves no wallet route. */
export const isDemoServer = () => process.env.DEMO_MODE === "1"

/** The demo-mode answer for an app/api/* route (404 demo_mode), or null in local mode. */
export function demoGuard(): Response | null {
  return isDemoServer() ? Response.json(DEMO_MODE_BODY, { status: 404 }) : null
}

/** The JSON body of a request, {} when there is none. */
export async function body<T extends Record<string, unknown>>(req: Request): Promise<Partial<T>> {
  try {
    return (await req.json()) as Partial<T>
  } catch {
    return {}
  }
}

/**
 * Server-sent events from a route handler: `start` receives a `send` and returns a cleanup. The stream closes when
 * the client disconnects (request.signal) or when `send` is told the stream is done.
 */
export function sse(req: Request, start: (send: (data: unknown) => void, close: () => void) => () => void): Response {
  let cleanup: (() => void) | null = null
  let timer: ReturnType<typeof setInterval> | null = null
  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder()
      let open = true
      const close = () => {
        if (!open) return
        open = false
        if (timer) clearInterval(timer)
        cleanup?.()
        try { controller.close() } catch { /* already closed */ }
      }
      const send = (data: unknown) => {
        if (!open) return
        try { controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`)) } catch { close() }
      }
      timer = setInterval(() => { if (open) try { controller.enqueue(enc.encode(": ping\n\n")) } catch { close() } }, 15_000)
      req.signal.addEventListener("abort", close)
      cleanup = start(send, close)
    },
    cancel() {
      if (timer) clearInterval(timer)
      cleanup?.()
    },
  })
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" } })
}
