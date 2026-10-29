"use client"

import { useEffect, useState } from "react"
import { failureOf, post } from "@/lib/api"
import { DEMO, REPO_URL, startEngine } from "@/lib/browser/demo"
import { toast, toastFailure } from "./ui/toast"

/**
 * Demo mode only: the one quiet line under the top bar. Where the keys live, that nothing is sent until a wallet is
 * funded, the backup download, the repo. It also starts the browser engine as soon as any page opens.
 */
export function DemoBanner() {
  const [downloading, setDownloading] = useState(false)
  useEffect(() => { startEngine() }, [])
  if (!DEMO) return null
  const downloadBackup = async () => {
    setDownloading(true)
    try {
      const r = await post<{ count: number; files: string[] }>("/api/wallets/backup")
      toast(r.count ? { tone: "ok", title: `Backup downloaded: ${r.count} wallet${r.count === 1 ? "" : "s"}, now usable` } : { tone: "muted", title: "Every wallet is already backed up" })
      window.dispatchEvent(new Event("wallets-changed"))
    } catch (e) { toastFailure(failureOf(e)) } finally { setDownloading(false) }
  }
  return (
    <div role="note" className="text-muted-foreground border-b px-5 py-1.5 text-center text-xs sm:px-6">
      Demo: wallets live in this browser, nothing is sent until you fund one.{" "}
      <button type="button" className="hover:text-foreground underline underline-offset-4" onClick={() => void downloadBackup()} disabled={downloading}>{downloading ? "Downloading…" : "Download backup"}</button>
      {" · "}
      <a className="hover:text-foreground underline underline-offset-4" href={REPO_URL} target="_blank" rel="noreferrer">Clone it</a> to run locally.
    </div>
  )
}
