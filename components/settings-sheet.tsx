"use client"

import { useEffect, useState } from "react"
import { ExternalLink } from "lucide-react"
import { apiFetch, useAction } from "@/lib/client"
import { ApiError } from "@/components/api-error"
import type { Status } from "@/components/status-strip"
import { Button } from "@/components/ui/button"
import { Field, Input } from "@/components/ui/input"
import { Sheet } from "@/components/ui/sheet"

type SettingsView = { apiUrl: string; apiKeyConfigured: boolean; apiKeyPrefix: string | null; apiKeyFrom: string; jitoTipLamports: number; slippage: number; dir: string; file: string }

/** API key (+ Connected check), API URL under Advanced, Jito tip, slippage, the backup folder (read-only). Saved to _app/pumpfun-starter/settings.json. */
export function SettingsSheet({ open, onClose, status, onSaved }: { open: boolean; onClose: () => void; status: Status | null; onSaved: () => void }) {
  const [s, setS] = useState<SettingsView | null>(null)
  const [apiKey, setApiKey] = useState("")
  const [apiUrl, setApiUrl] = useState("")
  const [tip, setTip] = useState("")
  const [slippage, setSlippage] = useState("")
  const [advanced, setAdvanced] = useState(false)
  const { busy, error, run } = useAction()

  useEffect(() => {
    if (!open) return
    void apiFetch<SettingsView>("/api/settings").then((v) => { setS(v); setApiUrl(v.apiUrl); setTip(String(v.jitoTipLamports)); setSlippage(String(v.slippage)); setApiKey("") })
  }, [open])

  const save = () =>
    run("save", async () => {
      await apiFetch("/api/settings", { method: "PUT", json: { ...(apiKey ? { apiKey } : {}), apiUrl: apiUrl || null, jitoTipLamports: tip === "" ? null : Number(tip), slippage: slippage === "" ? null : Number(slippage) } })
      onSaved()
      onClose()
    })
  const clearKey = () => run("clear", async () => { await apiFetch("/api/settings", { method: "PUT", json: { apiKey: null } }); onSaved(); setS(await apiFetch<SettingsView>("/api/settings")) })

  return (
    <Sheet open={open} onClose={onClose} title="Settings" description="Saved to settings.json in your wallet folder. The .env file provides the defaults.">
      <div className="flex flex-col gap-5 pt-1">
        <Field label="API key" hint={s?.apiKeyConfigured ? `A key is set (${s.apiKeyPrefix}, from ${s.apiKeyFrom}). Paste a new one to replace it.` : "No key yet."}>
          <Input type="password" autoComplete="off" placeholder={s?.apiKeyConfigured ? "•••••••••••••• (unchanged)" : "paste your key"} value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
        </Field>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className={status?.api.connected ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}>{status?.api.connected ? `Connected · GET /api/me ok (key ${status.api.keyPrefix})` : status?.api.configured ? `Not connected: ${status.api.error}` : "Not connected"}</span>
          <a className="inline-flex items-center gap-1 underline underline-offset-4" href={`${s?.apiUrl ?? "https://api.trenchytools.lol"}/api/create-api-key?label=pumpfun-starter`} target="_blank" rel="noreferrer">
            Create a key <ExternalLink className="size-3" />
          </a>
        </div>
        <Field label="Jito tip (lamports)" hint="Paid inside the create transaction of a launch bundle. 5000000 = 0.005 SOL.">
          <Input inputMode="numeric" value={tip} onChange={(e) => setTip(e.target.value)} />
        </Field>
        <Field label="Slippage default (%)" hint="Used by trades and launches unless the form says otherwise.">
          <Input inputMode="numeric" value={slippage} onChange={(e) => setSlippage(e.target.value)} />
        </Field>
        <Field label="Backup folder" hint="Set WALLET_BACKUP_DIR in .env to move it. Every wallet is a file in here.">
          <Input readOnly value={s?.dir ?? ""} className="font-mono text-xs" />
        </Field>
        <button type="button" className="text-muted-foreground self-start text-xs underline underline-offset-4" onClick={() => setAdvanced((v) => !v)}>
          {advanced ? "Hide advanced" : "Advanced"}
        </button>
        {advanced && (
          <Field label="API URL" hint="Leave as is unless you run your own instance.">
            <Input value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} />
          </Field>
        )}
        <ApiError error={error} />
        <div className="flex gap-2">
          <Button onClick={save} disabled={busy !== null}>{busy === "save" ? "Saving…" : "Save"}</Button>
          {s?.apiKeyFrom === "settings" && <Button variant="outline" onClick={clearKey} disabled={busy !== null}>Remove saved key</Button>}
        </div>
      </div>
    </Sheet>
  )
}
