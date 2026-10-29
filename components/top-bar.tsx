"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Settings } from "lucide-react"
import { apiFetch } from "@/lib/client"
import { cn } from "@/lib/cn"
import { Logo } from "./logo"
import { MoreMenu } from "./more-menu"
import { SettingsSheet } from "./settings-sheet"
import { type Status } from "./status-strip"
import { ThemeToggle } from "./theme-toggle"

const NAV = [
  { href: "/launch", label: "Launch" },
  { href: "/trading", label: "Trading" },
  { href: "/wallets", label: "Wallets" },
]
const LIVE = "https://pumpfun.trenchy.tools"
const REPO = "https://github.com/Trenchy-Tools/trenchytools-pumpfun-launcher"

/**
 * Seven targets: wordmark · Launch · Trading · Wallets · one status dot (opens Settings) · Get an API key · ⋯ menu
 * (docs, examples, GitHub, theme, Settings). Everything about keys, wallets and folders lives behind the dot.
 */
export function TopBar() {
  const pathname = usePathname()
  const [status, setStatus] = useState<Status | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const refresh = useCallback(() => { void apiFetch<Status>("/api/settings/status").then(setStatus).catch(() => {}) }, [])
  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 30_000)
    window.addEventListener("wallets-changed", refresh)
    return () => { clearInterval(t); window.removeEventListener("wallets-changed", refresh) }
  }, [refresh])

  // the dot: green = key accepted and a ★ wallet exists; amber = something to do; red = the key is rejected
  const pending = status?.backups.pending ?? 0
  const tone = !status ? "bg-muted-foreground" : status.api.configured && !status.api.connected ? "bg-destructive" : status.api.connected && status.funding && !pending ? "bg-ok" : "bg-warn"
  const text = !status ? "checking…" : status.api.configured && !status.api.connected ? `API key rejected${status.api.code ? ` (${status.api.code})` : ""}` : !status.api.connected ? "no API key yet" : !status.funding ? "key ok · no ★ wallet yet" : pending ? `${pending} wallet${pending === 1 ? "" : "s"} not backed up` : `key ok · ★ ${status.funding.sol === null ? "" : `${status.funding.sol.toFixed(3)} SOL`}`

  return (
    <header className="bg-background/80 sticky top-0 z-40 border-b backdrop-blur-md">
      <div className="flex h-14 w-full items-center gap-6 px-5 sm:px-6">
        <Link href="/launch" aria-label="Home" className="flex text-[17px]">
          <Logo />
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={cn("rounded-md px-2.5 py-1.5 transition-colors", pathname?.startsWith(n.href) ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={() => setSettingsOpen(true)} className="text-muted-foreground hover:text-foreground inline-flex h-8 items-center gap-2 rounded-md border px-2.5 text-xs transition-colors" title={`${text}. Click for Settings.`}>
            <span className={cn("size-2 rounded-full", tone)} />
            <span className="hidden sm:inline">{text}</span>
          </button>
          <a href="https://trenchy.tools/docs/api-keys" target="_blank" rel="noreferrer" className="bg-foreground text-background inline-flex h-8 items-center rounded-md px-3 text-sm font-medium whitespace-nowrap transition-opacity hover:opacity-90">Get an API key</a>
          <MoreMenu current={LIVE} repo={REPO}>
            <div className="flex items-center justify-between px-2.5 py-1.5 text-sm"><span>Theme</span><ThemeToggle /></div>
            <button type="button" className="hover:bg-muted flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm" onClick={() => setSettingsOpen(true)}><Settings className="size-4" /> Settings</button>
          </MoreMenu>
        </div>
      </div>
      <SettingsSheet open={settingsOpen} onClose={() => setSettingsOpen(false)} status={status} onSaved={refresh} />
    </header>
  )
}
