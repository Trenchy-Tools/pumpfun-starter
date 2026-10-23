"use client"

import { useCallback, useEffect, useState } from "react"
import { Copy } from "lucide-react"
import { apiFetch, copy, short, useAction } from "@/lib/client"
import { ApiError } from "@/components/api-error"
import { Button } from "@/components/ui/button"
import { Card, CardDescription, CardHeader, CardTitle, Pill } from "@/components/ui/card"
import { Field, Input } from "@/components/ui/input"
import { Mono, Table, TBody, TD, TH, THead, TR } from "@/components/ui/table"
import { Toggle } from "@/components/ui/toggle"

type Job = { jobId: string | null; status: "idle" | "running" | "done" | "failed"; suffix: string; prefix: string; caseSensitive: boolean; attempts: number; expectedAttempts: number; elapsedMs: number; rate: number; pooled: boolean; found: string | null; error: string | null; poolReady: Record<string, number> }
type Pool = { file: string; available: number; used: number; entries: Array<{ publicKey: string; suffix: string; prefix: string; status: "available" | "used"; createdAt: string; usedFor?: string; source: string }> }

export default function VanityPage() {
  const [suffix, setSuffix] = useState("pump")
  const [prefix, setPrefix] = useState("")
  const [caseSensitive, setCaseSensitive] = useState(true)
  const [job, setJob] = useState<Job | null>(null)
  const [pool, setPool] = useState<Pool | null>(null)
  const [random, setRandom] = useState<string | null>(null)
  const { busy, error, run } = useAction()

  const refresh = useCallback(async () => {
    const [j, p] = await Promise.all([apiFetch<Job>("/api/vanity/status"), apiFetch<Pool>("/api/vanity/pool")])
    setJob(j)
    setPool(p)
  }, [])
  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    if (job?.status !== "running") return
    const t = setInterval(refresh, 2000)
    return () => clearInterval(t)
  }, [job?.status, refresh])

  const start = () => run("start", async () => { setJob(await apiFetch<Job>("/api/vanity/start", { json: { suffix, prefix, caseSensitive } })); void refresh() })
  const preview = () => run("random", async () => setRandom((await apiFetch<{ publicKey: string }>("/api/vanity/random")).publicKey))

  const progress = job && job.expectedAttempts > 0 ? Math.min(1, job.attempts / job.expectedAttempts) : 0

  return (
    <div className="grid gap-6 lg:grid-cols-[400px_1fr]">
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader><CardTitle>Grind a mint address</CardTitle><CardDescription>Ground on the API&apos;s workers (POST /api/sol/vanity). Suffix + prefix together at most 4 characters; common suffixes come from a warm pool at once.</CardDescription></CardHeader>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Suffix"><Input value={suffix} onChange={(e) => setSuffix(e.target.value)} placeholder="pump" /></Field>
            <Field label="Prefix"><Input value={prefix} onChange={(e) => setPrefix(e.target.value)} /></Field>
          </div>
          <Toggle checked={caseSensitive} onChange={setCaseSensitive} label="Case sensitive (pump.fun shows the exact case)" />
          <Button onClick={start} disabled={busy !== null || job?.status === "running" || (!suffix && !prefix)} className="self-start">{job?.status === "running" ? "Grinding…" : "Grind"}</Button>
          <ApiError error={error} />
          {job && job.status !== "idle" && (
            <div className="flex flex-col gap-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone={job.status === "done" ? "ok" : job.status === "failed" ? "bad" : "warn"}>{job.status}</Pill>
                <span className="text-muted-foreground">{job.prefix}…{job.suffix}{job.pooled ? " · from the warm pool" : ""}{job.jobId ? ` · job ${job.jobId.slice(0, 8)}` : ""}</span>
              </div>
              <div className="bg-muted h-1.5 overflow-hidden rounded-full"><div className="bg-foreground h-full transition-all" style={{ width: `${Math.round(progress * 100)}%` }} /></div>
              <div className="text-muted-foreground grid grid-cols-3 gap-2 text-xs">
                <span>{job.attempts.toLocaleString()} attempts</span>
                <span>~{job.expectedAttempts.toLocaleString()} expected</span>
                <span>{job.rate.toLocaleString()} / s</span>
              </div>
              {job.found && <div className="flex items-center gap-2">Found <Mono className="break-all">{job.found}</Mono><Button variant="ghost" size="icon-xs" aria-label="Copy" onClick={() => copy(job.found!)}><Copy /></Button></div>}
              {job.error && <div className="text-destructive">{job.error}</div>}
            </div>
          )}
          {job && Object.keys(job.poolReady).length > 0 && <p className="text-muted-foreground text-xs">Warm on the API: {Object.entries(job.poolReady).map(([k, v]) => `${k} × ${v}`).join(", ")}</p>}
        </Card>
        <Card className="gap-2">
          <CardTitle>Random</CardTitle>
          <CardDescription>A launch with mint mode &quot;random&quot; uses <code>Keypair.generate()</code> and saves the key to the pool as used. Preview what one looks like:</CardDescription>
          <div className="flex items-center gap-2"><Button variant="outline" size="sm" onClick={preview} disabled={busy !== null}>Generate preview</Button>{random && <Mono className="text-xs break-all">{random}</Mono>}</div>
        </Card>
        <p className="text-muted-foreground text-xs">Mint keypairs hold no funds and are not wallets: they live in the pool file, not in the wallet folder. <Mono>{pool?.file}</Mono></p>
      </div>

      <Card className="gap-3">
        <div className="flex items-center gap-2">
          <CardTitle className="mr-auto">Pool</CardTitle>
          <Pill tone="ok">{pool?.available ?? 0} available</Pill>
          <Pill>{pool?.used ?? 0} used</Pill>
        </div>
        <Table>
          <THead><TR><TH>Address</TH><TH>Pattern</TH><TH>Source</TH><TH>Status</TH><TH>Created</TH></TR></THead>
          <TBody>
            {!pool?.entries.length && <TR><TD colSpan={5} className="text-muted-foreground py-6 text-center">Empty. Grind one on the left.</TD></TR>}
            {pool?.entries.map((e) => (
              <TR key={e.publicKey}>
                <TD><span className="inline-flex items-center gap-1"><Mono>{short(e.publicKey, 8)}</Mono><Button variant="ghost" size="icon-xs" aria-label="Copy" onClick={() => copy(e.publicKey)}><Copy /></Button></span></TD>
                <TD>{e.prefix || e.suffix ? `${e.prefix}…${e.suffix}` : "random"}</TD>
                <TD>{e.source}</TD>
                <TD><Pill tone={e.status === "available" ? "ok" : "muted"}>{e.status}</Pill>{e.usedFor && <span className="text-muted-foreground ml-1 text-xs">launch {e.usedFor}</span>}</TD>
                <TD className="text-muted-foreground text-xs">{new Date(e.createdAt).toLocaleString()}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>
    </div>
  )
}
