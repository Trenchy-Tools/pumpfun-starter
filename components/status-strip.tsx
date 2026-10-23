"use client"

import { FolderOpen, KeyRound, Wallet } from "lucide-react"
import { short, sol } from "@/lib/client"
import { Pill } from "@/components/ui/card"

export type Status = {
  api: { configured: boolean; connected: boolean; url: string; keyPrefix?: string; error?: string; code?: string }
  funding: { publicKey: string; label: string; sol: number | null; backedUp: boolean } | null
  backups: { dir: string; wallets: number }
}

/** The three pills on the right of the top bar: API key · funding wallet · backup folder. */
export function StatusStrip({ status, onOpenSettings }: { status: Status | null; onOpenSettings: () => void }) {
  if (!status) return <Pill>loading…</Pill>
  const api = status.api
  return (
    <div className="flex items-center gap-1.5">
      <button type="button" onClick={onOpenSettings} title={api.error ?? (api.connected ? `Connected to ${api.url}` : "Add an API key in Settings")}>
        <Pill tone={api.connected ? "ok" : api.configured ? "bad" : "warn"}>
          <KeyRound className="size-3" />
          {api.connected ? `key ${api.keyPrefix ?? "ok"}` : api.configured ? (api.code ?? "key rejected") : "no API key"}
        </Pill>
      </button>
      <Pill tone={status.funding ? (status.funding.backedUp ? "muted" : "bad") : "warn"} title={status.funding ? `★ ${status.funding.label} · ${status.funding.publicKey}` : "Create a wallet on the Wallets page: the first one becomes ★"}>
        <Wallet className="size-3" />
        {status.funding ? `★ ${short(status.funding.publicKey)} · ${sol(status.funding.sol, 3)}` : "no ★ wallet"}
      </Pill>
      <Pill className="hidden max-w-[22rem] lg:inline-flex" title={status.backups.dir}>
        <FolderOpen className="size-3" />
        <span className="truncate font-mono text-[11px]">{status.backups.dir}</span>
        <span>· {status.backups.wallets}</span>
      </Pill>
    </div>
  )
}
