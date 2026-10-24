/**
 * The two errors every flow can throw, and the one JSON shape they leave the app in. Shared by the server routes
 * (lib/http.ts, local mode) and the browser engine (lib/browser/engine.ts, demo mode). No node imports.
 *
 *   ApiError          the TrenchyTools API refused: { error, code, hint?, docs? } + extra fields, status as sent
 *   NotBackedUpError  the backup rule: a wallet whose key is not backed up is never funded or used (409 not_backed_up)
 */
import type { Quote } from "../trenchy"

/**
 * Every API error body is `{ error, code, hint?, docs? }` plus, on some codes, extra fields: `no_quote_balance` carries
 * `needed`, `have`, `quote` and the `account` to fund; `creator_fee_not_allowed` carries `min` / `max`. All of it rides
 * along here (`extra`); show it verbatim, branch on `code`.
 */
export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string, public hint?: string, public docs?: string, public extra: Record<string, unknown> = {}) {
    super(message)
    this.name = "ApiError"
  }
  /** `needed` / `have` / `quote` / `account` of a 409 no_quote_balance, typed. */
  get quoteShortfall(): { needed: number; have: number; quote: Quote; account: string } | null {
    if (this.code !== "no_quote_balance") return null
    const q = this.extra.quote as Quote | undefined
    return { needed: Number(this.extra.needed ?? 0), have: Number(this.extra.have ?? 0), quote: q ?? { mint: "So11111111111111111111111111111111111111112", symbol: "SOL", decimals: 9, kind: "sol" }, account: String(this.extra.account ?? "") }
  }
  toJSON() {
    return { ...this.extra, error: this.message, code: this.code, hint: this.hint, docs: this.docs, status: this.status }
  }
}

/**
 * The backup rule's refusal. Local mode says which folder is missing the file (lib/wallets.ts); demo mode says the key
 * has not been downloaded yet (lib/browser/keystore.ts). Same code, same status, everywhere.
 */
export class NotBackedUpError extends Error {
  code = "not_backed_up" as const
  constructor(public publicKey: string, message: string, public hint: string, public dir?: string) {
    super(message)
    this.name = "NotBackedUpError"
  }
}

/** A refusal of the request itself (a missing field, no ★ wallet yet): answered with its own status, usually 400. */
export class RouteError extends Error {
  constructor(message: string, public status = 400) {
    super(message)
    this.name = "RouteError"
  }
}

/** Any thrown value → the status and JSON body a route answers with: `{ error, code?, hint?, docs?, … }`. */
export function errorBody(err: unknown, status?: number): { status: number; body: Record<string, unknown> } {
  if (err instanceof RouteError) return { status: err.status, body: { error: err.message } }
  if (err instanceof NotBackedUpError) return { status: 409, body: { error: err.message, code: err.code, hint: err.hint, publicKey: err.publicKey, ...(err.dir ? { dir: err.dir } : {}) } }
  // the API's extra fields ride along (no_quote_balance: needed / have / quote / account; creator_fee_not_allowed: min / max)
  if (err instanceof ApiError) return { status: err.status >= 400 && err.status < 600 ? err.status : 502, body: { ...err.extra, error: err.message, code: err.code, hint: err.hint, docs: err.docs } }
  const message = err instanceof Error ? err.message : err && typeof err === "object" && "error" in err ? String((err as { error: unknown }).error) : String(err)
  const code = (err as { code?: string })?.code
  return { status: status ?? 500, body: { error: message, ...(code ? { code } : {}) } }
}

/** The answer of a route that does not exist in this mode (demo mode: every server route; see lib/http.ts demoGuard). */
export const DEMO_MODE_BODY = {
  error: "This hosted demo keeps no server state: wallets, launches and trades run in your browser.",
  code: "demo_mode",
  hint: "Use the pages of this app (they call the TrenchyTools API straight from the browser), or clone the repo to run it on your own machine: https://github.com/Trenchy-Tools/pumpfun-starter",
}
