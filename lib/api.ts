"use client"

/**
 * The browser side of the app's own routes (app/api/*), shared word for word by the pump.fun and pons starters.
 * Every failure is a Failure carrying exactly what the route (and, through it, the TrenchyTools API) returned:
 * error · code · hint · docs. Show it with <FailureBox> or toastFailure().
 */
export type Failure = { error: string; code?: string; hint?: string; docs?: string; status?: number; publicKey?: string; dir?: string; [k: string]: unknown }

export class FailureError extends Error {
  constructor(public failure: Failure) {
    super(failure.error)
  }
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(path, init)
  const text = await res.text()
  let data: Record<string, unknown> = {}
  try { data = JSON.parse(text) as Record<string, unknown> } catch { /* not JSON */ }
  if (!res.ok) throw new FailureError({ ...data, error: String(data.error ?? `HTTP ${res.status}`), status: res.status } as Failure)
  return data as T
}

export const get = <T,>(path: string) => request<T>(path, { method: "GET" })
export const post = <T,>(path: string, json: unknown = {}) => request<T>(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(json) })
export const del = <T,>(path: string) => request<T>(path, { method: "DELETE" })

export const failureOf = (e: unknown): Failure => (e instanceof FailureError ? e.failure : e && typeof e === "object" && "error" in e ? (e as Failure) : { error: e instanceof Error ? e.message : String(e) })

/** One line for a toast or a log: the message, then the code and hint when the API sent them. */
export const failureText = (f: Failure) => `${f.error}${f.code ? ` · ${f.code}` : ""}${f.hint ? ` · ${f.hint}` : ""}`

/** Subscribe to one of the app's server-sent-event routes. `onOpen` fires when the stream is connected. Returns the unsubscribe. */
export function subscribe<T>(path: string, onEvent: (e: T) => void, onOpen?: () => void, onError?: () => void): () => void {
  const es = new EventSource(path)
  es.onopen = () => onOpen?.()
  es.onmessage = (m) => { try { onEvent(JSON.parse(m.data) as T) } catch { /* ignore */ } }
  es.onerror = () => onError?.()
  return () => es.close()
}

export const copyText = (text: string) => navigator.clipboard?.writeText(text)

/** Download a text file from the browser (Export keys). */
export function downloadText(name: string, text: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** The coin the Trading page (or a launch) chose: the Wallets page shows its balance column. Kept in this browser only. */
const COIN_KEY = "starter.coin"
export type ChosenCoin = { coin: string; symbol?: string }
export function readChosenCoin(): ChosenCoin | null {
  try { return JSON.parse(localStorage.getItem(COIN_KEY) ?? "null") as ChosenCoin | null } catch { return null }
}
export function writeChosenCoin(c: ChosenCoin | null) {
  try { if (c) localStorage.setItem(COIN_KEY, JSON.stringify(c)); else localStorage.removeItem(COIN_KEY) } catch { /* private window */ }
}

/** Tell the top bar (and other pages) that the folder changed. */
export const walletsChanged = () => window.dispatchEvent(new Event("wallets-changed"))
