"use client"

import { useEffect, useState } from "react"
import { ExternalLink } from "lucide-react"
import { apiFetch, useAction, type ApiErrorBody } from "@/lib/client"
import { DEMO, DEMO_KEY_LABEL } from "@/lib/browser/demo"
import { ApiError } from "@/components/api-error"
import type { Status } from "@/components/status-strip"
import { Button } from "@/components/ui/button"
import { Field, Input } from "@/components/ui/input"
import { Sheet } from "@/components/ui/sheet"

/** `keyError`: demo mode only, why creating the visitor's key failed, verbatim from the API. */
type SettingsView = { apiUrl: string; apiKeyConfigured: boolean; apiKeyPrefix: string | null; apiKeyFrom: string; jitoTipLamports: number; slippage: number; dir: string; file: string; keyError?: ApiErrorBody | null }

/**
 * API key (+ Connected check), API URL under Advanced, Jito tip, slippage, the backup folder (read-only). Saved to
 * _app/pumpfun-starter/settings.json. Demo mode: the visitor's own key (created in this browser on the first visit, shown
 * masked, replaceable by pasting or "Create a new key"; a refusal is shown exactly as the API sent it), saved in this browser.
 */
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
  const createKey = () => run("create", async () => { setS(await apiFetch<SettingsView>("/api/settings", { method: "PUT", json: { createKey: true } })); onSaved() })
  const clearKey = () => run("clear", async () => { await apiFetch("/api/settings", { method: "PUT", json: { apiKey: null } }); onSaved(); setS(await apiFetch<SettingsView>("/api/settings")) })

  return (
    <Sheet open={open} onClose={onClose} title="Settings" description={DEMO ? "Saved in this browser. Your API key was made for you on your first visit; it is yours alone." : "Saved to settings.json in your wallet folder. The .env file provides the defaults."}>
      <div className="flex flex-col gap-5 pt-1">
        <Field label="API key" hint={s?.apiKeyConfigured ? (DEMO ? `Your key, kept in this browser: ${s.apiKeyPrefix}. Paste another to replace it.` : `A key is set (${s.apiKeyPrefix}, from ${s.apiKeyFrom}). Paste a new one to replace it.`) : "No key yet."}>
          <Input type="password" autoComplete="off" placeholder={s?.apiKeyConfigured ? "•••••••••••••• (unchanged)" : "paste your key"} value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
        </Field>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className={status?.api.connected ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}>{status?.api.connected ? `Connected · GET /api/me ok (key ${status.api.keyPrefix})` : status?.api.configured ? `Not connected: ${status.api.error}` : "Not connected"}</span>
          {DEMO ? (
            <button type="button" className="underline underline-offset-4" onClick={createKey} disabled={busy !== null} title={`GET /api/create-api-key?label=${DEMO_KEY_LABEL}`}>{busy === "create" ? "Creating…" : "Create a new key"}</button>
          ) : (
            <a className="inline-flex items-center gap-1 underline underline-offset-4" href={`${s?.apiUrl ?? "https://api.trenchy.tools"}/api/create-api-key?label=pumpfun-starter`} target="_blank" rel="noreferrer">
              Create a key <ExternalLink className="size-3" />
            </a>
          )}
        </div>
        {DEMO && s?.keyError && !s.apiKeyConfigured ? (
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground text-xs">Creating your key failed. The API said:</span>
            <ApiError error={s.keyError} />
            <span className="text-muted-foreground text-xs">Paste a key you already have above, or try again later.</span>
          </div>
        ) : null}
        <Field label="Jito tip (lamports)" hint="Paid inside the create transaction of a launch bundle. 5000000 = 0.005 SOL.">
          <Input inputMode="numeric" value={tip} onChange={(e) => setTip(e.target.value)} />
        </Field>
        <Field label="Slippage default (%)" hint="Used by trades and launches unless the form says otherwise.">
          <Input inputMode="numeric" value={slippage} onChange={(e) => setSlippage(e.target.value)} />
        </Field>
        {DEMO ? (
          <Field label="Keys" hint="Every wallet lives in this browser only. Download backup saves the keys as files; clearing this site's data deletes them.">
            <Input readOnly value={s?.file ?? ""} className="font-mono text-xs" />
          </Field>
        ) : (
          <Field label="Backup folder" hint="Set WALLET_BACKUP_DIR in .env to move it. Every wallet is a file in here.">
            <Input readOnly value={s?.dir ?? ""} className="font-mono text-xs" />
          </Field>
        )}
        {DEMO ? null : <button type="button" className="text-muted-foreground self-start text-xs underline underline-offset-4" onClick={() => setAdvanced((v) => !v)}>
          {advanced ? "Hide advanced" : "Advanced"}
        </button>}
        {advanced && !DEMO && (
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
