"use client"

/**
 * The "⋯" menu at the right of the top bar: Docs · the three working examples (live + code) · this app's repository,
 * then whatever the app adds (theme, Settings). One target in the header instead of six. The same file in all three
 * starters (no app-specific imports).
 */
import * as React from "react"
import { Ellipsis, ExternalLink } from "lucide-react"

const SITE = "https://trenchy.tools"
const ORG = "https://github.com/Trenchy-Tools"
const EXAMPLES = [
  { name: "pump.fun launcher", chain: "Solana", live: "https://pumpfun.trenchy.tools", repo: `${ORG}/trenchytools-pumpfun-launcher` },
  { name: "pons launcher", chain: "Robinhood Chain", live: "https://pons.trenchy.tools", repo: `${ORG}/trenchytools-pons-launcher` },
  { name: "wallet mover", chain: "Solana · Robinhood · ETH · BNB", live: "https://mover.trenchy.tools", repo: `${ORG}/trenchytools-wallet-mover` },
]
const ROW = "hover:bg-muted flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm"

/** `current`: this app's live host. `repo`: this app's repository. `children`: the app's own rows (theme, Settings). */
export function MoreMenu({ current, repo, children, className = "" }: { current: string; repo: string; children?: React.ReactNode; className?: string }) {
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [])
  return (
    <div ref={ref} className={`relative ${className}`}>
      <button type="button" aria-label="More" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="hover:bg-accent inline-flex size-8 items-center justify-center rounded-md border transition-colors"><Ellipsis className="size-4" /></button>
      {open ? (
        <div className="bg-background absolute top-full right-0 z-50 mt-2 w-72 rounded-xl border p-1.5 shadow-xl" onClick={(e) => { if ((e.target as HTMLElement).closest("a")) setOpen(false) }}>
          <a className={ROW} href={SITE} target="_blank" rel="noreferrer">trenchy.tools <ExternalLink className="text-muted-foreground ml-auto size-3" /></a>
          <a className={ROW} href={`${SITE}/docs`} target="_blank" rel="noreferrer">API docs <ExternalLink className="text-muted-foreground ml-auto size-3" /></a>
          <a className={ROW} href={repo} target="_blank" rel="noreferrer">This app on GitHub <ExternalLink className="text-muted-foreground ml-auto size-3" /></a>
          <p className="text-muted-foreground mt-1 border-t px-2.5 pt-2 pb-0.5 text-[11px] tracking-wide uppercase">Other examples</p>
          {EXAMPLES.filter((x) => x.live !== current).map((x) => (
            <div key={x.live} className={ROW}>
              <a href={x.live} target="_blank" rel="noreferrer" className="min-w-0 flex-1"><span className="block truncate">{x.name}</span><span className="text-muted-foreground block truncate font-mono text-[11px]">{x.chain}</span></a>
              <a href={x.repo} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground rounded-md border px-1.5 py-0.5 font-mono text-[11px]">code</a>
            </div>
          ))}
          {children ? <div className="mt-1 border-t pt-1">{children}</div> : null}
        </div>
      ) : null}
    </div>
  )
}
