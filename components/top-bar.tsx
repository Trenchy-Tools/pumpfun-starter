"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Settings } from "lucide-react"
import { apiFetch } from "@/lib/client"
import { cn } from "@/lib/cn"
import { Logo } from "./logo"
import { SettingsSheet } from "./settings-sheet"
import { SiteLinks } from "./site-links"
import { StatusStrip, type Status } from "./status-strip"
import { ThemeToggle } from "./theme-toggle"
import { Button } from "./ui/button"

const NAV = [
  { href: "/launch", label: "Launch" },
  { href: "/trading", label: "Trading" },
  { href: "/wallets", label: "Wallets" },
  { href: "/vanity", label: "Vanity" },
]

/** logo · Launch · Trading · Wallets · Vanity · (right) API key · funding wallet · backups folder · theme · settings */
export function TopBar() {
  const pathname = usePathname()
  const [status, setStatus] = useState<Status | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const refresh = useCallback(() => { void apiFetch<Status>("/api/settings/status").then(setStatus).catch(() => {}) }, [])
  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 30_000)
    const onFocus = () => refresh()
    window.addEventListener("wallets-changed", onFocus)
    return () => { clearInterval(t); window.removeEventListener("wallets-changed", onFocus) }
  }, [refresh])

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
          <SiteLinks current="https://pumpfun.trenchy.tools" repo="https://github.com/Trenchy-Tools/trenchytools-pumpfun-launcher" className="mr-2" />
          <StatusStrip status={status} onOpenSettings={() => setSettingsOpen(true)} />
          <ThemeToggle className="hidden sm:flex" />
          <Button variant="outline" size="icon-sm" aria-label="Settings" onClick={() => setSettingsOpen(true)}>
            <Settings />
          </Button>
        </div>
      </div>
      <SettingsSheet open={settingsOpen} onClose={() => setSettingsOpen(false)} status={status} onSaved={refresh} />
    </header>
  )
}
