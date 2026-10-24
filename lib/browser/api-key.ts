"use client"

/**
 * The visitor's own TrenchyTools API key (demo mode). Every visitor gets a key of their own, created in their browser
 * and kept in localStorage: no setup, their own rate limits, and our main key never ships to a browser.
 *
 *   ensureApiKey()   the stored key; or, once per page load, GET <api>/api/create-api-key?label=<label> → store it
 *   setApiKey(k)     the visitor pasted another key (Settings), or null to forget it
 *   keyError()       why creation failed, EXACTLY as the API said it (5 new keys per hour per IP: 429 rate_limited)
 *
 * Generic: every starter passes its own storage key, API URL and label.
 */

export type KeyFailure = { error: string; code?: string; hint?: string; docs?: string; status?: number; [k: string]: unknown }
export type KeyOptions = { storageKey: string; apiUrl: string; label: string }

let creating: Promise<string | null> | null = null
let lastError: KeyFailure | null = null

export function readApiKey(o: KeyOptions): string | null {
  try {
    const k = window.localStorage.getItem(o.storageKey)
    return k && k.trim() ? k.trim() : null
  } catch {
    return null
  }
}

/** Keep a key (pasted in Settings), or forget it with null. A refused write throws. */
export function setApiKey(o: KeyOptions, key: string | null): void {
  try {
    if (key && key.trim()) window.localStorage.setItem(o.storageKey, key.trim())
    else window.localStorage.removeItem(o.storageKey)
  } catch (e) {
    throw new Error(`This browser refused to store the key (${e instanceof Error ? e.message : e})`)
  }
  if (key) lastError = null
}

/** GET /api/create-api-key: a fresh key with no wallets, labelled for this app. Throws the API's error body verbatim. */
export async function createApiKey(o: KeyOptions): Promise<string> {
  let res: Response
  try {
    res = await fetch(`${o.apiUrl}/api/create-api-key?label=${encodeURIComponent(o.label)}`, { method: "GET" })
  } catch (e) {
    throw { error: `TrenchyTools API unreachable at ${o.apiUrl} (${e instanceof Error ? e.message : e})`, code: "unreachable" } satisfies KeyFailure
  }
  const text = await res.text()
  let body: Record<string, unknown> = {}
  try { body = JSON.parse(text) as Record<string, unknown> } catch { /* not JSON */ }
  if (!res.ok || typeof body.apiKey !== "string") throw { ...body, error: String(body.error ?? `HTTP ${res.status}`), status: res.status } as KeyFailure
  return body.apiKey
}

/**
 * The key to use: the stored one, or a new one created now (at most one attempt per page load, shared by every caller).
 * Null when there is none; keyError() then says why.
 */
export function ensureApiKey(o: KeyOptions): Promise<string | null> {
  const have = readApiKey(o)
  if (have) return Promise.resolve(have)
  if (creating) return creating.then((k) => k ?? readApiKey(o))
  creating = createApiKey(o).then(
    (k) => { setApiKey(o, k); lastError = null; return k },
    (e: KeyFailure) => { lastError = e; return null },
  )
  return creating
}

/** Make a new key on request (Settings → "Create a new key"): replaces the stored one only when the API gives one. */
export async function replaceApiKey(o: KeyOptions): Promise<string> {
  try {
    const k = await createApiKey(o)
    setApiKey(o, k)
    return k
  } catch (e) {
    lastError = e as KeyFailure
    throw e
  }
}

export const keyError = (): KeyFailure | null => lastError

/** For display only: the first 6 and last 4 characters. */
export const maskKey = (k: string) => (k.length > 12 ? `${k.slice(0, 6)}…${k.slice(-4)}` : "••••")
