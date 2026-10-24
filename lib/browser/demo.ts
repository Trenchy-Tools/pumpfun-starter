"use client"

/**
 * Demo mode: the mode flag, this app's constants, and THE SEAM between the pages and whatever answers them.
 *
 *   local mode (default)        appFetch("/api/…") is fetch("/api/…"): the app's own route handlers on this machine
 *   demo mode (NEXT_PUBLIC_DEMO=1, build time)
 *                               appFetch("/api/…") is answered in the browser by lib/browser/engine.ts, which has the
 *                               same routes with the same request and response shapes, keeps the wallets in
 *                               localStorage and calls https://api.trenchy.tools straight from the tab
 *
 * The pages never know which one answered: lib/api.ts and lib/client.ts (the two fetch wrappers) call appFetch, and the
 * two server-sent-event streams (launch log, live trades) open through appEvents. The engine is a separate chunk, loaded
 * only in demo mode; a local build never ships it.
 *
 * Porting to another starter: copy this file, change the constants block, give the app a lib/browser/engine.ts that
 * exports `handle(req: Request): Promise<Response>` and `stream(url: URL): EventStream | null`.
 */

// ── this app ────────────────────────────────────────────────────────────────

/** Built with NEXT_PUBLIC_DEMO=1: the hosted demo. Inlined at build time, so the unused branch is dropped. */
export const DEMO = process.env.NEXT_PUBLIC_DEMO === "1"
/** Where visitors clone the app to run it on their own machine. */
export const REPO_URL = "https://github.com/Trenchy-Tools/pumpfun-starter"
/** The API the demo talks to, straight from the browser (the CSP in next.config.ts allows exactly this host). */
export const DEMO_API_URL = "https://api.trenchy.tools"
/** The label of the per-visitor key: GET /api/create-api-key?label=demo-pumpfun */
export const DEMO_KEY_LABEL = "demo-pumpfun"
/** localStorage namespace: every key this app writes starts with it. */
export const STORE_PREFIX = "trenchytools.pumpfun-starter"
/** What the status strip says instead of the folder path. */
export const KEYS_HOME = "this browser"

export const BANNER = "Demo mode: your wallets live in this browser only. Download your backup before funding anything. Clearing site data deletes them. We never see your keys."
export const TAB_NOTE = "Keep this tab open: timed sells and running launches run in it (timed sells resume when you reopen the page)."

// ── the seam ────────────────────────────────────────────────────────────────

/** The same thing a route handler returns from `sse(req, start)` (lib/http.ts): send events, return the cleanup. */
export type EventStream = (send: (data: unknown) => void, close: () => void) => () => void

type Engine = { handle: (req: Request) => Promise<Response>; stream: (url: URL) => EventStream | null }
let engine: Promise<Engine> | null = null
const loadEngine = () => (engine ??= import("./engine") as Promise<Engine>)

/** fetch() for the app's own /api/* routes: the server in local mode, the browser engine in demo mode. */
export async function appFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (!DEMO) return fetch(path, init)
  const { handle } = await loadEngine()
  return handle(new Request(new URL(path, window.location.origin), init))
}

/** Warm the engine early (demo mode): timed sells resume and the visitor's key is created as soon as a page opens. */
export function startEngine(): void {
  if (DEMO) void loadEngine()
}

/** The part of EventSource the pages use. */
export type EventSourceLike = { onopen: (() => void) | null; onmessage: ((m: { data: string }) => void) | null; onerror: (() => void) | null; close: () => void }

/** An EventSource whose events come from the browser engine instead of the network. */
class LocalEventSource implements EventSourceLike {
  onopen: (() => void) | null = null
  onmessage: ((m: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  private closed = false
  private cleanup: (() => void) | null = null
  constructor(path: string) {
    void loadEngine().then(({ stream }) => {
      if (this.closed) return
      const start = stream(new URL(path, window.location.origin))
      if (!start) { this.onerror?.(); return }
      this.onopen?.()
      // events are delivered on a later tick, like the network would, so handlers set after construction see them all
      this.cleanup = start((data) => { if (!this.closed) setTimeout(() => this.onmessage?.({ data: JSON.stringify(data) }), 0) }, () => this.close())
    }, () => this.onerror?.())
  }
  close() {
    if (this.closed) return
    this.closed = true
    this.cleanup?.()
  }
}

/** new EventSource(path) for the app's own event routes: the server in local mode, the browser engine in demo mode. */
export function appEvents(path: string): EventSourceLike {
  return DEMO ? new LocalEventSource(path) : (new EventSource(path) as unknown as EventSourceLike)
}
