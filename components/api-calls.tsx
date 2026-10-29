"use client"

/**
 * The dry run's payoff: every call this app made to the TrenchyTools API, in order, with status, time and what came
 * back. This is the demo: a developer sees which HTTP calls do the work.
 * The same file in all three starters (no app-specific imports); the calls come from the API client's trace.
 */
import * as React from "react"

export type ApiCall = { method: string; path: string; status: number; ms: number; note?: string; error?: string }

const tone = (c: ApiCall) => (c.status >= 200 && c.status < 300 ? "text-ok" : c.status === 0 ? "text-destructive" : c.status >= 400 ? "text-destructive" : "text-warn")

export function ApiCalls({ calls, title = "API calls", empty = "Press Dry run: every call to the API shows here, with what came back. Nothing is sent.", className = "" }: { calls: ApiCall[] | null | undefined; title?: string; empty?: string; className?: string }) {
  const [openIdx, setOpenIdx] = React.useState<number | null>(null)
  const total = calls?.reduce((s, c) => s + c.ms, 0) ?? 0
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {calls?.length ? <span className="text-muted-foreground text-xs">{calls.length} call{calls.length === 1 ? "" : "s"} · {total} ms</span> : null}
      </div>
      {!calls?.length ? <p className="text-muted-foreground text-sm">{empty}</p> : (
        <ol className="flex flex-col gap-1 font-mono text-xs">
          {calls.map((c, i) => (
            <li key={i} className="rounded-md border px-2.5 py-1.5">
              <button type="button" className="flex w-full items-center gap-2 text-left" onClick={() => setOpenIdx(openIdx === i ? null : i)}>
                <span className="text-muted-foreground w-5 shrink-0 text-right">{i + 1}</span>
                <span className="w-11 shrink-0 font-semibold">{c.method}</span>
                <span className="min-w-0 flex-1 truncate">{c.path}</span>
                <span className={`shrink-0 ${tone(c)}`}>{c.status || "ERR"}</span>
                <span className="text-muted-foreground w-14 shrink-0 text-right">{c.ms} ms</span>
              </button>
              {c.note || c.error ? <div className={`mt-1 pl-7 font-sans ${c.error ? "text-destructive" : "text-muted-foreground"} ${openIdx === i ? "" : "truncate"}`}>→ {c.error ?? c.note}</div> : null}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
