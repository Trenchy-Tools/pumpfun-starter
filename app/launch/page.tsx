"use client"

/**
 * Launch, the short way: fill the coin in, pick how many wallets buy with it, press Launch.
 *
 *   1. the image + details go to IPFS by themselves when you press Launch (POST /api/ipfs; no upload button)
 *   2. every "new wallet" row is created (and backed up) right before the launch (POST /api/wallets)
 *   3. POST /api/launch, the log streams in, and the moment the coin is live the Trading page opens on it
 *
 * Everything else (pair, Mayhem, holder rewards, creator fee, dev wallet, slippage, snipers, Jito) sits under Advanced.
 */
import * as React from "react"
import { useRouter } from "next/navigation"
import { ImagePlus, SlidersHorizontal } from "lucide-react"
import { FailureBox } from "@/components/failure"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Field, Input, Select, Textarea } from "@/components/ui/input"
import { Pill } from "@/components/ui/pill"
import { Mono } from "@/components/ui/table"
import { Toggle } from "@/components/ui/toggle"
import { failureOf, get, post, subscribe, walletsChanged, type Failure } from "@/lib/api"
import { DEMO, TAB_NOTE } from "@/lib/browser/demo"
import { chain } from "@/lib/chain"

type Wallet = { publicKey: string; label: string; role: string }
type PlanRow = { role: string; label: string; publicKey: string | null; buy: number; needSol: number; needQuote?: number; haveQuote?: number; sendQuote?: number }
type Shortfall = { role: string; label: string; publicKey: string | null; send: number; symbol: string }
type Plan = { rows: PlanRow[]; total: number; tipSol: number; useLut: boolean; quote: { symbol: string }; custom: boolean; mayhem: boolean; holderReward: boolean; creatorFeeBps: number; totalQuote: number; shortfalls: Shortfall[]; refusal: Failure | null; ok: boolean }
type Pair = { mint: string; symbol: string; name?: string | null; decimals: number; source: "sol" | "global" | "quoteControl" | "pumpCoin"; kind: "sol" | "stable" | "stock" | "crypto" | "pump" }
type PoolView = { available: number; used: number }
type Job = { status: "idle" | "running" | "done" | "failed"; attempts: number; expectedAttempts: number; rate: number; found: string | null; error: string | null }
type Event = { at: number; stage: string; message: string; signature?: string; mint?: string; link?: string }
type Simulate = { ok: boolean; checks: Array<{ name: string; ok: boolean; detail: string }>; simulation: { ok: boolean; logs: string[] } | null }
/** One buyer row: a wallet of the folder, or null = a new wallet made at launch; the amount as typed. */
type Row = { publicKey: string | null; amount: string }

const SOL_PAIR: Pair = { mint: "So11111111111111111111111111111111111111112", symbol: "SOL", name: "Solana", decimals: 9, source: "sol", kind: "sol" }
const PAIR_GROUPS: Array<{ kind: Pair["kind"]; title: string }> = [{ kind: "stable", title: "Stablecoins" }, { kind: "stock", title: "Tokenized stocks (xStocks)" }, { kind: "crypto", title: "Crypto" }, { kind: "pump", title: "pump.fun coins" }]
const BUNDLE_COUNTS = [0, 1, 2, 3, 4, 6, 8, 12, 16]
const HOLDER_COUNTS = [0, 1, 2, 3, 4, 5, 6, 8, 10]
const SNIPER_COUNTS = [0, 1, 2, 3, 5, 10]
const DEV_CHIPS = ["0.1", "0.25", "0.5", "1", "2"]
const ALL_CHIPS = ["0.05", "0.1", "0.25", "0.5", "1"]

const n = (v: string, d = 0) => (v.trim() === "" || Number.isNaN(Number(v)) ? d : Number(v))
const resize = (rows: Row[], count: number, fill: string): Row[] => Array.from({ length: count }, (_, i) => rows[i] ?? { publicKey: null, amount: fill })
const fmt = (x: number) => (x >= 1e6 ? `${(x / 1e6).toFixed(1)}M` : x >= 1e3 ? `${(x / 1e3).toFixed(1)}K` : String(x))

/** A small round choice button, the bundler's "chip". */
function Chip({ active, className = "", ...props }: React.ComponentProps<"button"> & { active?: boolean }) {
  return <button type="button" className={`inline-flex h-7 min-w-7 items-center justify-center rounded-full border px-2.5 font-mono text-xs transition-colors disabled:opacity-50 ${active ? "bg-foreground text-background border-foreground" : "hover:bg-accent"} ${className}`} {...props} />
}

export default function LaunchPage() {
  const router = useRouter()
  const [f, setF] = React.useState({ name: "", symbol: "", description: "", twitter: "", telegram: "", website: "", devBuySol: "0.5", slippage: "15", creatorFeeBps: "", sniperGapMs: "400", holderDelayS: "10", holderWindowS: "60" })
  const [image, setImage] = React.useState<File | null>(null)
  const [preview, setPreview] = React.useState("")
  const [dragOver, setDragOver] = React.useState(false)
  const fileRef = React.useRef<HTMLInputElement>(null)
  // the wallets
  const [wallets, setWallets] = React.useState<Wallet[]>([])
  const [balances, setBalances] = React.useState<Map<string, number>>(new Map())
  const [main, setMain] = React.useState<string | null>(null)
  const [devWallet, setDevWallet] = React.useState("")
  const [bundle, setBundle] = React.useState<Row[]>(resize([], 2, "0.1"))
  const [holders, setHolders] = React.useState<Row[]>([])
  const [snipers, setSnipers] = React.useState<Row[]>([])
  // mint
  const [mintMode, setMintMode] = React.useState<"random" | "vanity">("random")
  const [pool, setPool] = React.useState<PoolView>({ available: 0, used: 0 })
  const [job, setJob] = React.useState<Job | null>(null)
  // advanced
  const [advanced, setAdvanced] = React.useState(false)
  const [pairs, setPairs] = React.useState<Pair[]>([SOL_PAIR])
  const [quoteMint, setQuoteMint] = React.useState(SOL_PAIR.mint)
  const [mayhem, setMayhem] = React.useState(false)
  const [holderReward, setHolderReward] = React.useState(false)
  const [useJito, setUseJito] = React.useState(true)
  const [fundFirst, setFundFirst] = React.useState(true)
  // plan, simulation, the run
  const [plan, setPlan] = React.useState<Plan | null>(null)
  const [sim, setSim] = React.useState<Simulate | null>(null)
  const [busy, setBusy] = React.useState<string | null>(null)
  const [failure, setFailure] = React.useState<Failure | null>(null)
  const [events, setEvents] = React.useState<Event[]>([])
  const [launchId, setLaunchId] = React.useState<string | null>(null)
  const [done, setDone] = React.useState<"live" | "error" | null>(null)
  const logRef = React.useRef<HTMLDivElement>(null)

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((s) => ({ ...s, [k]: e.target.value }))
  const pair = pairs.find((p) => p.mint === quoteMint) ?? SOL_PAIR
  const custom = pair.source !== "sol"
  const sym = pair.symbol
  const mayhemAllowed = pair.source === "sol" || pair.source === "global"
  const feeAllowed = pair.source === "quoteControl" || pair.source === "pumpCoin"
  const dev = devWallet || main
  const mainBalance = main ? balances.get(main) : undefined
  const launching = launchId !== null && done === null

  /** The form the routes take (lib/core/form.ts). `publicKey: null` rows are new wallets; the launch resolves them first. */
  const form = (metadataUri = "", rows = { bundle, snipers, holders }) => ({
    name: f.name, symbol: f.symbol, description: f.description, twitter: f.twitter, telegram: f.telegram, website: f.website, metadataUri,
    mint: { mode: mintMode },
    quoteMint: custom ? pair.mint : "SOL", mayhemMode: mayhem && mayhemAllowed, holderReward, creatorFeeBps: feeAllowed ? n(f.creatorFeeBps) : 0,
    devWallet: devWallet || undefined, devBuySol: n(f.devBuySol),
    bundle: { wallets: rows.bundle.map((r) => ({ publicKey: r.publicKey, amount: n(r.amount) })) },
    snipers: { wallets: rows.snipers.map((r) => ({ publicKey: r.publicKey, amount: n(r.amount) })), gapMs: n(f.sniperGapMs, 400) },
    holders: { wallets: rows.holders.map((r) => ({ publicKey: r.publicKey, amount: n(r.amount) })), delayS: n(f.holderDelayS, 10), windowS: n(f.holderWindowS, 60) },
    fundFirst, useJito, slippage: n(f.slippage, 15),
  })

  // ── data ──────────────────────────────────────────────────────────────────
  const loadWallets = React.useCallback(async () => {
    const r = await get<{ wallets: Wallet[]; mainWallet: string | null }>("/api/wallets")
    setWallets(r.wallets); setMain(r.mainWallet)
    if (r.wallets.length) get<{ rows: Array<{ publicKey: string; native: number }> }>("/api/wallets/balances").then((b) => setBalances(new Map(b.rows.map((x) => [x.publicKey, x.native])))).catch(() => {})
  }, [])
  const loadPool = React.useCallback(() => get<PoolView>("/api/vanity/pool").then((p) => setPool({ available: p.available, used: p.used })).catch(() => {}), [])
  React.useEffect(() => {
    void loadWallets().catch(() => {})
    void loadPool()
    get<{ pairs: Pair[] }>("/api/launch/pairs").then((r) => setPairs(r.pairs.some((p) => p.source === "sol") ? r.pairs : [SOL_PAIR, ...r.pairs])).catch(() => {})
    get<Job>("/api/vanity/status").then(setJob).catch(() => {})
  }, [loadWallets, loadPool])
  React.useEffect(() => { const t = setInterval(() => void loadWallets().catch(() => {}), 20_000); return () => clearInterval(t) }, [loadWallets])

  // the image preview
  React.useEffect(() => {
    if (!image) { setPreview(""); return }
    const url = URL.createObjectURL(image)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [image])

  // the cost, recomputed as the numbers change (the plan does not need the image)
  const planKey = JSON.stringify([f.devBuySol, devWallet, bundle, snipers, holders, useJito, f.slippage, quoteMint, mayhem && mayhemAllowed, holderReward, feeAllowed ? f.creatorFeeBps : ""])
  React.useEffect(() => {
    const t = setTimeout(() => { post<Plan>("/api/launch/plan", form()).then(setPlan).catch(() => {}) }, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planKey])

  // vanity grinding: follow the API job
  React.useEffect(() => {
    if (job?.status !== "running") return
    const t = setInterval(async () => {
      const j = await get<Job>("/api/vanity/status").catch(() => null)
      if (!j) return
      setJob(j)
      if (j.status !== "running") void loadPool()
    }, 2000)
    return () => clearInterval(t)
  }, [job?.status, loadPool])

  // the launch log, then the Trading page the moment the coin is live
  React.useEffect(() => {
    if (!launchId) return
    return subscribe<Event>(`/api/launch/${launchId}/events`, (e) => {
      setEvents((xs) => [...xs, e])
      if (e.stage === "error") setDone("error")
      if (e.stage === "live" && e.mint) {
        setDone("live")
        const mint = e.mint
        setTimeout(() => router.push(`/trading?mint=${encodeURIComponent(mint)}&launch=${encodeURIComponent(launchId)}`), 900)
      }
    })
  }, [launchId, router])
  React.useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }) }, [events])

  // ── actions ───────────────────────────────────────────────────────────────
  const run = async (name: string, fn: () => Promise<void>) => {
    setBusy(name); setFailure(null)
    try { await fn() } catch (e) { setFailure(failureOf(e)) } finally { setBusy(null) }
  }
  const note = (stage: string, message: string) => setEvents((xs) => [...xs, { at: Date.now(), stage, message }])

  /** Image + details → IPFS, as part of Launch (and Simulate, so the simulated create carries the real metadata). */
  const uploadMetadata = async (): Promise<string> => {
    if (!image) throw { error: "Pick an image first" }
    const fd = new FormData()
    fd.append("file", image)
    fd.append("name", f.name); fd.append("symbol", f.symbol); fd.append("description", f.description)
    for (const k of ["twitter", "telegram", "website"] as const) if (f[k]) fd.append(k, f[k])
    const res = await fetchApp("/api/ipfs", fd)
    return res.metadataUri
  }
  /** Every "new wallet" row becomes a real wallet (POST /api/wallets); in demo mode the keys are downloaded right away so the launch may use them. */
  const resolveRows = async (): Promise<{ bundle: Row[]; snipers: Row[]; holders: Row[] }> => {
    const out = { bundle: [...bundle], snipers: [...snipers], holders: [...holders] }
    let made = 0
    for (const [key, role] of [["bundle", "bundle"], ["snipers", "sniper"], ["holders", "holder"]] as const) {
      const rows = out[key]
      const missing = rows.filter((r) => !r.publicKey).length
      if (!missing) continue
      const r = await post<{ dir: string; wallets: Array<{ publicKey: string; label: string }> }>("/api/wallets", { count: missing, role })
      const fresh = [...r.wallets]
      out[key] = rows.map((row) => (row.publicKey ? row : { ...row, publicKey: fresh.shift()!.publicKey }))
      made += r.wallets.length
    }
    if (made) {
      note("wallets", `${made} new wallet${made === 1 ? "" : "s"} created${DEMO ? "" : " and written to the folder"}`)
      if (DEMO) { const b = await post<{ count: number; files: string[] }>("/api/wallets/backup"); note("wallets", `Backup downloaded (${b.files.join(", ")}): the new keys are now usable`) }
      walletsChanged()
      void loadWallets().catch(() => {})
      setBundle(out.bundle); setSnipers(out.snipers); setHolders(out.holders)
    }
    return out
  }

  const simulate = () => run("simulate", async () => {
    setSim(null)
    const metadataUri = image ? await uploadMetadata().catch(() => "") : ""
    setSim(await post<Simulate>("/api/launch/simulate", form(metadataUri)))
  })
  const grind = () => run("grind", async () => setJob(await post<Job>("/api/vanity/start", { suffix: "pump", caseSensitive: true })))

  const buyers = bundle.length + snipers.length + holders.length
  const ready = !!f.name && !!f.symbol && !!image
  const short = fundFirst && plan !== null && mainBalance !== undefined && mainBalance < plan.total
  const blocker = !main ? "Create a ★ wallet first (Wallets)" : !ready ? "Name, symbol and an image are needed" : plan && !plan.ok ? "Fix the cost card first" : short ? `Not enough SOL (need ${plan!.total.toFixed(3)}, ★ has ${mainBalance!.toFixed(3)})` : null

  const launch = () => run("launch", async () => {
    if (blocker) throw { error: blocker }
    if (!confirm(`Launch ${f.name} (${f.symbol}) with ${buyers} buyer wallet${buyers === 1 ? "" : "s"}? About ${plan?.total.toFixed(3) ?? "…"} SOL leaves the ★ wallet. This sends real transactions.`)) return
    setEvents([]); setDone(null); setSim(null)
    note("ipfs", "Uploading the image and details to IPFS…")
    const metadataUri = await uploadMetadata()
    note("ipfs", `Metadata ready: ${metadataUri}`)
    const rows = await resolveRows()
    const r = await post<{ id: string }>("/api/launch", form(metadataUri, rows))
    setLaunchId(r.id)
  })

  // ── pieces ────────────────────────────────────────────────────────────────
  const taken = new Set([...(dev ? [dev] : []), ...[...bundle, ...snipers, ...holders].map((r) => r.publicKey).filter(Boolean)])
  const Rows = ({ rows, onChange, prefix }: { rows: Row[]; onChange: (rows: Row[]) => void; prefix: string }) => (
    <div className="flex flex-col gap-1.5">
      {rows.length > 0 ? (
        <div className="text-muted-foreground flex flex-wrap items-center gap-1 text-xs">all:
          {ALL_CHIPS.map((v) => <Chip key={v} className="h-6" onClick={() => onChange(rows.map((r) => ({ ...r, amount: v })))}>{v}</Chip>)}
        </div>
      ) : null}
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="text-muted-foreground w-6 font-mono text-xs">{prefix}{i + 1}</span>
          <Input inputMode="decimal" className="h-8 w-24 font-mono text-xs" value={r.amount} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} aria-label={`${prefix}${i + 1} amount`} />
          <span className="text-muted-foreground text-xs">{sym}</span>
          <Select className="h-8 max-w-56 flex-1 text-xs" value={r.publicKey ?? ""} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, publicKey: e.target.value || null } : x)))} aria-label={`${prefix}${i + 1} wallet`}>
            <option value="">new wallet</option>
            {wallets.filter((w) => w.publicKey === r.publicKey || !taken.has(w.publicKey)).map((w) => <option key={w.publicKey} value={w.publicKey}>{w.label} · {chain.short(w.publicKey)} · {chain.fmt(balances.get(w.publicKey))} SOL</option>)}
          </Select>
        </div>
      ))}
    </div>
  )
  const stageTone = (s: string) => (s === "error" || s === "warning" ? "text-destructive" : s === "live" || s === "done" ? "text-ok" : "")

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="flex flex-col gap-5">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Launch</h1>
          <p className="text-muted-foreground text-sm">A pump.fun coin with a dev buy and bundled buyers in one Jito bundle. The image uploads by itself; when the coin is live, Trading opens on it.</p>
        </div>

        {/* ── the coin ── */}
        <Card className="gap-3">
          <h2 className="text-[15px] font-semibold">Coin</h2>
          <div className="flex items-start gap-4">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }} onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); const file = e.dataTransfer.files?.[0]; if (file) setImage(file) }}
              className={`flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border-2 border-dashed transition-colors ${dragOver ? "border-foreground bg-accent" : "hover:border-foreground/60"}`}
              title="Click or drop an image (png, jpg, gif, webp, up to 4 MB). It is uploaded to IPFS when you launch."
            >
              {preview ? <img src={preview} alt="" className="size-full object-cover" /> : <span className="text-muted-foreground flex flex-col items-center gap-1 text-[11px]"><ImagePlus className="size-5" />image</span>}
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="hidden" onChange={(e) => setImage(e.target.files?.[0] ?? null)} />
            </button>
            <div className="grid flex-1 gap-3 sm:grid-cols-2">
              <Field label="Name"><Input maxLength={32} placeholder="My Coin" value={f.name} onChange={set("name")} /></Field>
              <Field label="Symbol"><Input maxLength={10} placeholder="COIN" value={f.symbol} onChange={(e) => setF((s) => ({ ...s, symbol: e.target.value.toUpperCase() }))} /></Field>
              <Field label="Description" className="sm:col-span-2"><Textarea className="min-h-14" placeholder="What is it?" value={f.description} onChange={set("description")} /></Field>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <Input className="text-xs" placeholder="Twitter / X URL" value={f.twitter} onChange={set("twitter")} />
            <Input className="text-xs" placeholder="Telegram URL" value={f.telegram} onChange={set("telegram")} />
            <Input className="text-xs" placeholder="Website URL" value={f.website} onChange={set("website")} />
          </div>
        </Card>

        {/* ── the buys ── */}
        <Card className="gap-4">
          <h2 className="text-[15px] font-semibold">Buys</h2>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Dev buy</span>
            <Input inputMode="decimal" className="h-8 w-24 font-mono text-xs" value={f.devBuySol} onChange={set("devBuySol")} aria-label="Dev buy" />
            <span className="text-muted-foreground text-xs">{sym}</span>
            {DEV_CHIPS.map((v) => <Chip key={v} active={f.devBuySol === v} onClick={() => setF((s) => ({ ...s, devBuySol: v }))}>{v}</Chip>)}
            <span className="text-muted-foreground ml-auto text-xs">dev wallet: {dev ? <>{wallets.find((w) => w.publicKey === dev)?.label ?? chain.short(dev)}{dev === main ? " ★" : ""} · {chain.fmt(balances.get(dev))} SOL</> : "none yet"}</span>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="flex flex-col gap-2 rounded-lg border p-3">
              <div className="text-ok text-[11px] font-semibold tracking-wide uppercase">Bundle buyers</div>
              <p className="text-muted-foreground text-xs">Buy in the same Jito bundle as the create, all in one block. Up to 4 go one per transaction; 5 to 16 use a lookup table (rent refunded after the launch).</p>
              <div className="flex flex-wrap gap-1">{BUNDLE_COUNTS.map((c) => <Chip key={c} active={bundle.length === c} onClick={() => setBundle(resize(bundle, c, "0.1"))}>{c}</Chip>)}</div>
              <Rows rows={bundle} onChange={setBundle} prefix="B" />
            </div>
            <div className="flex flex-col gap-2 rounded-lg border p-3">
              <div className="text-warn text-[11px] font-semibold tracking-wide uppercase">Holder wallets (optional)</div>
              <p className="text-muted-foreground text-xs">Buy after the launch, one by one:
                <Input inputMode="numeric" className="mx-1 inline-block h-6 w-12 px-1.5 text-center font-mono text-xs" value={f.holderDelayS} onChange={set("holderDelayS")} aria-label="Holder delay (s)" />s after the coin is live, spread over
                <Input inputMode="numeric" className="mx-1 inline-block h-6 w-12 px-1.5 text-center font-mono text-xs" value={f.holderWindowS} onChange={set("holderWindowS")} aria-label="Holder window (s)" />s.</p>
              <div className="flex flex-wrap gap-1">{HOLDER_COUNTS.map((c) => <Chip key={c} active={holders.length === c} onClick={() => setHolders(resize(holders, c, "0.1"))}>{c}</Chip>)}</div>
              <Rows rows={holders} onChange={setHolders} prefix="H" />
            </div>
          </div>
          <p className="text-muted-foreground text-xs">"new wallet" rows are created and saved {DEMO ? "in this browser (the backup downloads itself)" : "to the folder"} when you press Launch; pick an existing wallet to reuse one.</p>
        </Card>

        {/* ── the mint ── */}
        <Card className="gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-[15px] font-semibold">Mint address</h2>
            <div className="flex gap-1">
              <Chip active={mintMode === "random"} onClick={() => setMintMode("random")}>Random</Chip>
              <Chip active={mintMode === "vanity"} onClick={() => setMintMode("vanity")}>Vanity …pump</Chip>
            </div>
            {mintMode === "vanity" ? (
              <div className="flex flex-1 flex-wrap items-center gap-3 text-xs">
                <span className={pool.available > 0 ? "text-ok font-semibold" : "text-destructive font-semibold"}>{pool.available} ready</span>
                {job?.status === "running" ? <Mono className="text-warn text-xs">grinding …pump: {fmt(job.attempts)} / ~{fmt(job.expectedAttempts)} · {fmt(Math.round(job.rate))}/s</Mono> : null}
                {job?.status === "failed" && job.error ? <span className="text-destructive">{job.error}</span> : null}
                <Button size="xs" variant="outline" className="ml-auto" onClick={grind} disabled={!!busy || job?.status === "running"}>{job?.status === "running" ? "Grinding…" : "Grind one"}</Button>
              </div>
            ) : <span className="text-muted-foreground text-xs">Keypair.generate(); a vanity mint ends in …pump and comes from the pool (POST /api/sol/vanity grinds it).</span>}
          </div>
        </Card>

        {/* ── advanced ── */}
        <Button variant="outline" size="lg" className="h-auto w-full justify-between px-4 py-3 text-left" onClick={() => setAdvanced((v) => !v)} aria-expanded={advanced}>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="flex items-center gap-2 font-semibold"><SlidersHorizontal className="size-4" /> Advanced options</span>
            <span className="text-muted-foreground truncate text-xs font-normal">{advanced ? "pair · Mayhem · holder rewards · creator fee · dev wallet · slippage · Jito · snipers" : `${custom ? `paired with ${sym}` : "paired with SOL"} · ${useJito ? "Jito bundle" : "no bundle"}${mayhem && mayhemAllowed ? " · Mayhem" : ""}${holderReward ? " · holder rewards" : ""}${snipers.length ? ` · ${snipers.length} sniper${snipers.length === 1 ? "" : "s"}` : ""} · dev = ${devWallet ? "custom" : "★"}`}</span>
          </span>
          <span className="shrink-0 text-base">{advanced ? "▴" : "▾"}</span>
        </Button>
        {advanced ? (
          <Card className="gap-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Pair with" hint={custom ? `buys are paid in ${sym}; every wallet must hold it. Fees stay in SOL.` : "SOL: the ordinary pump.fun coin"}>
                <Select value={quoteMint} onChange={(e) => setQuoteMint(e.target.value)}>
                  <option value={SOL_PAIR.mint}>SOL · Solana</option>
                  {PAIR_GROUPS.map((g) => { const list = pairs.filter((p) => p.kind === g.kind && p.source !== "sol"); return list.length ? <optgroup key={g.kind} label={g.title}>{list.map((p) => <option key={p.mint} value={p.mint}>{p.symbol} · {p.name || chain.short(p.mint)}</option>)}</optgroup> : null })}
                </Select>
              </Field>
              <Field label="Dev wallet">
                <Select value={devWallet} onChange={(e) => setDevWallet(e.target.value)}>
                  <option value="">★ {wallets.find((w) => w.publicKey === main)?.label ?? "main wallet"}</option>
                  {wallets.filter((w) => w.publicKey !== main).map((w) => <option key={w.publicKey} value={w.publicKey}>{w.label} · {chain.short(w.publicKey)} · {chain.fmt(balances.get(w.publicKey))} SOL</option>)}
                </Select>
              </Field>
              <Field label="Slippage (%)"><Input inputMode="numeric" value={f.slippage} onChange={set("slippage")} /></Field>
              {feeAllowed ? <Field label="Creator fee (bps)" hint="100 = 1 %; empty = pump.fun's schedule"><Input inputMode="numeric" placeholder="e.g. 50" value={f.creatorFeeBps} onChange={set("creatorFeeBps")} /></Field> : null}
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <Toggle checked={useJito} onChange={setUseJito} label="Jito bundle (off: create, then buys one by one)" />
              <Toggle checked={fundFirst} onChange={setFundFirst} label="Fund the buyers from ★ first" />
              <Toggle checked={mayhem && mayhemAllowed} onChange={(v) => mayhemAllowed && setMayhem(v)} label={<span className={mayhemAllowed ? "" : "opacity-60"}>Mayhem mode{mayhemAllowed ? "" : " (SOL / USDC pairs only)"}</span>} />
              <Toggle checked={holderReward} onChange={setHolderReward} label="Holder rewards (the creator fee goes to holders)" />
            </div>
            <div className="flex flex-col gap-2 rounded-lg border p-3">
              <div className="text-[11px] font-semibold tracking-wide uppercase">Snipers</div>
              <p className="text-muted-foreground text-xs">Separate buys fired the moment the bundle lands, <Input inputMode="numeric" className="mx-1 inline-block h-6 w-14 px-1.5 text-center font-mono text-xs" value={f.sniperGapMs} onChange={set("sniperGapMs")} aria-label="Sniper gap (ms)" /> ms apart.</p>
              <div className="flex flex-wrap gap-1">{SNIPER_COUNTS.map((c) => <Chip key={c} active={snipers.length === c} onClick={() => setSnipers(resize(snipers, c, "0.1"))}>{c}</Chip>)}</div>
              <Rows rows={snipers} onChange={setSnipers} prefix="S" />
            </div>
          </Card>
        ) : null}

        <FailureBox failure={failure} />
        <div className="flex gap-3">
          <Button variant="secondary" size="lg" className="flex-1" onClick={simulate} disabled={!!busy || launching || !main}>{busy === "simulate" ? "Simulating…" : "Simulate"}</Button>
          <Button size="lg" className={`flex-[2] ${short ? "bg-destructive hover:bg-destructive/90 text-white" : ""}`} onClick={launch} disabled={!!busy || launching || !!blocker}>
            {busy === "launch" ? "Starting…" : launching ? "Launching…" : blocker ?? `Launch (${plan ? plan.total.toFixed(3) : "…"} SOL)`}
          </Button>
        </div>
        {DEMO ? <p className="text-muted-foreground -mt-2 text-xs">{TAB_NOTE}</p> : null}
      </div>

      {/* ── right: cost, simulation, the run ── */}
      <div className="flex flex-col gap-4">
        <Card className="gap-2">
          <h2 className="text-[15px] font-semibold">Cost</h2>
          {plan ? (
            <>
              {plan.refusal ? <FailureBox failure={plan.refusal} /> : null}
              <div className="flex flex-col gap-1 text-sm">
                {plan.rows.map((r, i) => (
                  <div key={i} className="flex items-baseline justify-between gap-2">
                    <span className="text-muted-foreground truncate text-xs">{r.role === "dev" ? "Dev" : r.label} <span className="opacity-70">(buy {r.buy} {plan.quote.symbol}{plan.custom && r.sendQuote ? `, short ${r.sendQuote} ${plan.quote.symbol}` : ""})</span></span>
                    <Mono className={`text-xs ${plan.custom && r.sendQuote ? "text-destructive" : ""}`}>{r.needSol.toFixed(3)}</Mono>
                  </div>
                ))}
                {plan.useLut ? <div className="text-muted-foreground flex justify-between text-xs"><span>Lookup table rent (refunded)</span><Mono className="text-xs">0.020</Mono></div> : null}
                {useJito ? <div className="text-muted-foreground flex justify-between text-xs"><span>Jito tip (inside the dev amount)</span><Mono className="text-xs">{plan.tipSol.toFixed(3)}</Mono></div> : null}
                <div className="mt-1 flex items-baseline justify-between border-t pt-2 font-medium"><span>Leaves the ★ wallet</span><Mono className={short ? "text-destructive" : ""}>{plan.total.toFixed(3)} SOL</Mono></div>
                {plan.custom ? <div className="text-muted-foreground flex justify-between text-xs"><span>{plan.quote.symbol} across the wallets</span><Mono className="text-xs">{plan.totalQuote}</Mono></div> : null}
              </div>
              {plan.shortfalls.length ? <p className="text-destructive text-xs">Short of {plan.quote.symbol}: {plan.shortfalls.map((s) => `${s.label} needs ${s.send}`).join("; ")}. This app moves SOL only; send the {plan.quote.symbol} first.</p> : null}
              <p className="text-muted-foreground text-xs">Each buy becomes tokens; the API fee is 0.5 % of it; 0.01 SOL stays in every wallet for fees and rent (Gather on the Wallets page brings it back). ★ holds {mainBalance === undefined ? "…" : `${mainBalance.toFixed(4)} SOL`}.</p>
            </>
          ) : <p className="text-muted-foreground text-sm">…</p>}
        </Card>

        {sim ? (
          <Card className="gap-2">
            <h2 className={`text-[15px] font-semibold ${sim.ok ? "text-ok" : "text-warn"}`}>{sim.ok ? "Dry run passed" : "Dry run: fix these first"}</h2>
            <ul className="flex flex-col gap-1 text-xs">
              {sim.checks.map((c) => <li key={c.name} className="flex gap-2"><span className={c.ok ? "text-ok" : "text-destructive"}>{c.ok ? "✓" : "✗"}</span><span className="text-muted-foreground w-16 shrink-0">{c.name}</span><span className="break-all">{c.detail}</span></li>)}
            </ul>
            {sim.simulation && !sim.simulation.ok && sim.simulation.logs.length ? <pre className="bg-muted max-h-32 overflow-auto rounded-md p-2 text-[10px] whitespace-pre-wrap">{sim.simulation.logs.join("\n")}</pre> : null}
          </Card>
        ) : null}

        {events.length || launchId ? (
          <Card className={`gap-2 ${done === "error" ? "border-destructive/40" : done === "live" ? "border-ok/40" : ""}`}>
            <div className="flex items-center justify-between">
              <h2 className={`text-[15px] font-semibold ${done === "error" ? "text-destructive" : done === "live" ? "text-ok" : ""}`}>{done === "error" ? "Launch failed" : done === "live" ? "Live — opening Trading…" : "Launching…"}</h2>
              {done ? <Pill tone={done === "live" ? "ok" : "error"}>{done}</Pill> : null}
            </div>
            <div ref={logRef} className="flex max-h-80 flex-col gap-1 overflow-y-auto text-xs">
              {events.map((e, i) => (
                <div key={i} className={`flex gap-2 ${stageTone(e.stage)}`}>
                  <Mono className="text-muted-foreground w-16 shrink-0 text-[11px]">{e.stage}</Mono>
                  <span className="break-words">{e.message}{e.signature ? <> <a className="underline underline-offset-4" href={chain.explorerTx(e.signature)} target="_blank" rel="noreferrer">tx</a></> : null}</span>
                </div>
              ))}
              {launching ? <span className="text-muted-foreground">…</span> : null}
            </div>
          </Card>
        ) : (
          <Card className="gap-2 text-sm">
            <h2 className="text-[15px] font-semibold">How it runs</h2>
            <ol className="text-muted-foreground list-decimal space-y-1 pl-4 text-xs">
              <li>Image + details go to IPFS (POST /api/ipfs)</li>
              <li>"new wallet" rows are created, keys saved first</li>
              <li>★ funds every buyer (buy + fee + 0.01 reserve)</li>
              <li>Create + dev buy + bundle buys in one Jito bundle (POST /api/sol/trade-local → sign here → POST /api/sol/bundle)</li>
              <li>Holders buy after the delay</li>
              <li>The Trading page opens on the coin: chart, your wallets, sell buttons</li>
            </ol>
          </Card>
        )}
      </div>
    </div>
  )
}

/** POST a FormData to one of the app's routes (lib/api's post() is JSON-only). */
async function fetchApp(path: string, body: FormData): Promise<{ metadataUri: string }> {
  const { appFetch } = await import("@/lib/browser/demo")
  const res = await appFetch(path, { method: "POST", body })
  const text = await res.text()
  let data: Record<string, unknown> = {}
  try { data = JSON.parse(text) as Record<string, unknown> } catch { /* not JSON */ }
  if (!res.ok) throw { ...data, error: String(data.error ?? `HTTP ${res.status}`), status: res.status }
  return data as { metadataUri: string }
}
