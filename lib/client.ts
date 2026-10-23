"use client"

/**
 * Browser-side helpers: one fetch wrapper that turns every non-2xx answer into the API's error shape
 * ({ error, code, hint, docs }), a hook that runs an action and keeps its error, and small formatters.
 */
import { useCallback, useState } from "react"

export type ApiErrorBody = { error: string; code?: string; hint?: string; docs?: string; status?: number; [k: string]: unknown }

export async function apiFetch<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init
  const res = await fetch(path, json !== undefined ? { ...rest, method: rest.method ?? "POST", headers: { "content-type": "application/json", ...(rest.headers ?? {}) }, body: JSON.stringify(json) } : rest)
  const text = await res.text()
  let body: unknown = null
  try { body = JSON.parse(text) } catch { /* not JSON */ }
  if (!res.ok) {
    const b = (body ?? {}) as Partial<ApiErrorBody>
    throw { ...b, error: b.error ?? `HTTP ${res.status}`, status: res.status } as ApiErrorBody
  }
  return body as T
}

export const asApiError = (e: unknown): ApiErrorBody => (e && typeof e === "object" && "error" in e ? (e as ApiErrorBody) : { error: e instanceof Error ? e.message : String(e) })

/** Run an async action from a button: `busy` while it runs, `error` when it fails (cleared on the next run). */
export function useAction() {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<ApiErrorBody | null>(null)
  const run = useCallback(async <T,>(name: string, fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(name)
    setError(null)
    try {
      return await fn()
    } catch (e) {
      setError(asApiError(e))
      return undefined
    } finally {
      setBusy(null)
    }
  }, [])
  return { busy, error, run, clearError: () => setError(null) }
}

export const short = (pk: string, n = 4) => (pk.length > 2 * n + 1 ? `${pk.slice(0, n)}…${pk.slice(-n)}` : pk)
export const sol = (n: number | null | undefined, d = 4) => (n === null || n === undefined ? "–" : `${n.toFixed(d)} SOL`)
export const tokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n.toFixed(n < 1 ? 4 : 0))
export const ago = (ms: number) => { const s = Math.max(0, Math.round((Date.now() - ms) / 1000)); return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h` }
export const countdown = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` }
export const copy = (text: string) => navigator.clipboard?.writeText(text)
