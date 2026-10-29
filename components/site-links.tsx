"use client"

/**
 * The way back: trenchy.tools · Docs · Examples ▾ · GitHub, in every starter's top bar, so the header reads like the
 * docs site's and the API docs are never more than one click away while trying an example. The same file in all
 * three starters (no app-specific imports).
 */
import * as React from "react"
import { ChevronDown, ExternalLink } from "lucide-react"

/** The GitHub mark (lucide dropped brand icons). */
const Github = ({ className = "" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" aria-hidden className={className} fill="currentColor"><path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56v-2.17c-3.2.7-3.87-1.37-3.87-1.37-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.69 1.25 3.35.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.78 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.42-2.7 5.39-5.26 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" /></svg>
)

const SITE = "https://trenchy.tools"
const ORG = "https://github.com/Trenchy-Tools"
export const EXAMPLES = [
  { name: "pump.fun launcher", chain: "Solana", live: "https://pumpfun.trenchy.tools", repo: `${ORG}/trenchytools-pumpfun-launcher` },
  { name: "pons launcher", chain: "Robinhood Chain", live: "https://pons.trenchy.tools", repo: `${ORG}/trenchytools-pons-launcher` },
  { name: "wallet mover", chain: "Solana · Robinhood · ETH · BNB", live: "https://mover.trenchy.tools", repo: `${ORG}/trenchytools-wallet-mover` },
]
const LINK = "text-muted-foreground hover:text-foreground inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-sm transition-colors"

/** `current` is this app's live host, shown with a dot in the Examples menu. `repo` is this app's repository (the GitHub link). */
export function SiteLinks({ current, repo, className = "" }: { current: string; repo: string; className?: string }) {
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [])
  return (
    <div className={`hidden items-center md:flex ${className}`}>
      <a className={LINK} href={SITE} target="_blank" rel="noreferrer">trenchy.tools</a>
      <a className={LINK} href={`${SITE}/docs`} target="_blank" rel="noreferrer">Docs</a>
      <div ref={ref} className="relative">
        <button type="button" className={LINK} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          Examples <ChevronDown className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
        {open ? (
          <div className="bg-background absolute top-full left-1/2 z-50 mt-2 w-72 -translate-x-1/2 rounded-xl border p-1.5 shadow-xl">
            {EXAMPLES.map((x) => (
              <div key={x.live} className={`flex items-center gap-2 rounded-lg px-2.5 py-2 ${x.live === current ? "bg-muted" : "hover:bg-muted/60"}`}>
                <a href={x.live} target={x.live === current ? undefined : "_blank"} rel="noreferrer" className="min-w-0 flex-1" onClick={() => setOpen(false)}>
                  <span className="text-foreground block truncate text-sm">{x.name}{x.live === current ? <span className="text-muted-foreground"> · you are here</span> : null}</span>
                  <span className="text-muted-foreground block truncate font-mono text-[11px]">{x.chain}</span>
                </a>
                <a href={x.repo} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs" title="Repository on GitHub"><Github className="size-3.5" /> code</a>
              </div>
            ))}
            <a href={`${SITE}/docs/examples`} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground mt-1 flex items-center gap-1 border-t px-2.5 pt-2 pb-1 text-xs" onClick={() => setOpen(false)}>All examples and how to run them <ExternalLink className="size-3" /></a>
          </div>
        ) : null}
      </div>
      <a className={LINK} href={repo} target="_blank" rel="noreferrer" title="This app's repository"><Github className="size-4" /> GitHub</a>
    </div>
  )
}
