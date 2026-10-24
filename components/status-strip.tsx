"use client"

import { useState } from "react"
import { FolderOpen, KeyRound, Wallet } from "lucide-react"
import { failureOf, post } from "@/lib/api"
import { DEMO, KEYS_HOME } from "@/lib/browser/demo"
import { short, sol } from "@/lib/client"
import { Pill } from "@/components/ui/card"
import { toast, toastFailure } from "@/components/ui/toast"

export type Status = {
  api: { configured: boolean; connected: boolean; url: string; keyPrefix?: string; error?: string; code?: string }
  funding: { publicKey: string; label: string; sol: number | null; backedUp: boolean } | null
  /** `pending`: demo mode only, wallets whose key has not been downloaded yet */
  backups: { dir: string; wallets: number; pending?: number }
  /** demo mode only: why the visitor's key could not be created, as the API said it */
  keyError?: { error: string; code?: string; hint?: string; status?: number } | null
}

/** The three pills on the right of the top bar: API key · funding wallet · backup folder (demo mode: "Keys: this browser · Download backup"). */
export function StatusStrip({ status, onOpenSettings }: { status: Status | null; onOpenSettings: () => void }) {
  const [downloading, setDownloading] = useState(false)
  if (!status) return <Pill>loading…</Pill>
  const api = status.api
  const pending = status.backups.pending ?? 0
  const downloadBackup = async () => {
    setDownloading(true)
    try {
      const r = await post<{ count: number; files: string[] }>("/api/wallets/backup")
      toast(r.count ? { tone: "ok", title: `Backup downloaded: ${r.count} wallet${r.count === 1 ? "" : "s"}, now usable`, detail: <span className="font-mono text-xs break-all">{r.files.join(" · ")}</span> } : { tone: "muted", title: "Every wallet is already backed up" })
    } catch (e) {
      toastFailure(failureOf(e))
    } finally {
      setDownloading(false)
    }
  }
  return (
    <div className="flex items-center gap-1.5">
      <button type="button" onClick={onOpenSettings} title={api.error ?? (api.connected ? `Connected to ${api.url}` : "Add an API key in Settings")}>
        <Pill tone={api.connected ? "ok" : api.configured ? "bad" : "warn"}>
          <KeyRound className="size-3" />
          {api.connected ? `key ${api.keyPrefix ?? "ok"}` : api.configured ? (api.code ?? "key rejected") : DEMO && status.keyError ? (status.keyError.code ?? "no API key") : "no API key"}
        </Pill>
      </button>
      <Pill tone={status.funding ? (status.funding.backedUp ? "muted" : "bad") : "warn"} title={status.funding ? `★ ${status.funding.label} · ${status.funding.publicKey}${status.funding.backedUp ? "" : " · not backed up yet"}` : "Create a wallet on the Wallets page: the first one becomes ★"}>
        <Wallet className="size-3" />
        {status.funding ? `★ ${short(status.funding.publicKey)} · ${sol(status.funding.sol, 3)}` : "no ★ wallet"}
      </Pill>
      {DEMO ? (
        <Pill tone={pending ? "bad" : "muted"} className="hidden sm:inline-flex" title={pending ? `${pending} wallet${pending === 1 ? "" : "s"} not backed up yet: download the backup before funding` : "Every key is backed up. Clearing this site's data deletes the keys stored here."}>
          <FolderOpen className="size-3" />
          <span>Keys: {KEYS_HOME}</span>
          <span>·</span>
          <button type="button" className="underline underline-offset-4" onClick={() => void downloadBackup()} disabled={downloading}>{downloading ? "Downloading…" : "Download backup"}</button>
          {pending ? <span>({pending})</span> : null}
        </Pill>
      ) : (
        <Pill className="hidden max-w-[22rem] lg:inline-flex" title={status.backups.dir}>
          <FolderOpen className="size-3" />
          <span className="truncate font-mono text-[11px]">{status.backups.dir}</span>
          <span>· {status.backups.wallets}</span>
        </Pill>
      )}
    </div>
  )
}
