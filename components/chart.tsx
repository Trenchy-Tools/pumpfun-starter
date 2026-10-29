"use client"

/**
 * The coin's candle chart, embedded: GMGN's widget host (gmgn.cc/kline) in the page's theme. The same file in the
 * pump.fun and pons starters; lib/chain.ts says which chain slug and where "open on GMGN" goes.
 */
import * as React from "react"
import { useTheme } from "next-themes"
import { ExternalLink } from "lucide-react"
import { chain } from "@/lib/chain"

export function Chart({ coin, className = "" }: { coin: string; className?: string }) {
  const { resolvedTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)
  const [open, setOpen] = React.useState(true)
  React.useEffect(() => setMounted(true), [])
  const theme = resolvedTheme === "light" ? "light" : "dark"
  const url = mounted ? chain.chartUrl(coin, theme) : null
  const gmgn = chain.coinLinks(coin).find((l) => l.label === "gmgn")
  return (
    <div className={`bg-card overflow-hidden rounded-xl border ${className}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-1.5 text-xs">
        <span className="font-medium">Chart</span>
        <span className="text-muted-foreground">GMGN · a new coin shows up a few seconds after its first trade</span>
        <span className="ml-auto flex items-center gap-3">
          {gmgn ? <a className="inline-flex items-center gap-1 underline-offset-4 hover:underline" href={gmgn.href} target="_blank" rel="noreferrer">open on GMGN <ExternalLink className="size-3" /></a> : null}
          <button type="button" className="text-muted-foreground hover:text-foreground underline-offset-4 hover:underline" onClick={() => setOpen((v) => !v)}>{open ? "hide" : "show"}</button>
        </span>
      </div>
      {open ? (
        url ? <iframe key={url} src={url} title={`${chain.name} chart`} className="bg-background block h-[420px] w-full" loading="lazy" referrerPolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-popups" />
          : <div className="text-muted-foreground flex h-[420px] items-center justify-center text-sm">{mounted ? "No chart for this coin yet." : "…"}</div>
      ) : null}
    </div>
  )
}
