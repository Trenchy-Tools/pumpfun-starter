"use client"

import * as React from "react"
import { X } from "lucide-react"
import type { Failure } from "@/lib/api"

/**
 * Toasts: one call from anywhere (`toast()` / `toastFailure()`), rendered by the <Toaster /> in the layout. Results of a
 * trade or a transfer go here instead of a results card; an API error is shown verbatim (message · code · hint · docs)
 * and stays until dismissed.
 */
export type ToastTone = "ok" | "error" | "muted"
export type ToastItem = { id: number; tone: ToastTone; title: React.ReactNode; detail?: React.ReactNode; sticky?: boolean }

type Listener = (t: ToastItem) => void
const listeners = new Set<Listener>()
let seq = 0

export function toast(t: Omit<ToastItem, "id">): number {
  const item: ToastItem = { id: ++seq, ...t }
  for (const l of listeners) l(item)
  return item.id
}

/** An API failure as the API sent it: message, code, HTTP status, hint, docs link, folder. Stays until dismissed. */
export function toastFailure(f: Failure, title?: React.ReactNode): number {
  return toast({
    tone: "error", sticky: true, title: title ?? f.error,
    detail: (
      <span className="flex flex-wrap gap-x-2 gap-y-0.5">
        {title ? <span>{f.error}</span> : null}
        {f.code ? <code className="text-xs">{f.code}</code> : null}
        {f.status ? <span className="text-xs">HTTP {f.status}</span> : null}
        {f.hint ? <span>{f.hint}</span> : null}
        {f.docs ? <a className="underline underline-offset-4" href={f.docs} target="_blank" rel="noreferrer">docs</a> : null}
        {f.dir ? <span className="font-mono text-xs break-all">{f.dir}</span> : null}
      </span>
    ),
  })
}

export function Toaster() {
  const [items, setItems] = React.useState<ToastItem[]>([])
  const dismiss = React.useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), [])
  React.useEffect(() => {
    const l: Listener = (t) => {
      setItems((xs) => [...xs, t].slice(-6))
      if (!t.sticky) setTimeout(() => dismiss(t.id), 8000)
    }
    listeners.add(l)
    return () => { listeners.delete(l) }
  }, [dismiss])
  if (!items.length) return null
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-[min(28rem,calc(100vw-2rem))] flex-col gap-2">
      {items.map((t) => (
        <div key={t.id} role="status" className={`bg-background pointer-events-auto flex gap-3 rounded-lg border p-3 text-sm shadow-lg ${t.tone === "error" ? "border-destructive/50" : t.tone === "ok" ? "border-ok/50" : ""}`}>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className={`font-medium break-words ${t.tone === "error" ? "text-destructive" : ""}`}>{t.title}</div>
            {t.detail ? <div className="text-muted-foreground break-words">{t.detail}</div> : null}
          </div>
          <button type="button" aria-label="Dismiss" className="text-muted-foreground hover:text-foreground self-start" onClick={() => dismiss(t.id)}><X className="size-4" /></button>
        </div>
      ))}
    </div>
  )
}
