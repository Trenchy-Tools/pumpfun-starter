"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { ExternalLink } from "lucide-react"
import { apiFetch, short, useAction, type ApiErrorBody } from "@/lib/client"
import { chain } from "@/lib/chain"
import { ApiError } from "@/components/api-error"
import { WalletPicker, type PickedBuyer } from "@/components/wallet-picker"
import { Button } from "@/components/ui/button"
import { Card, CardDescription, CardHeader, CardTitle, Pill } from "@/components/ui/card"
import { Field, Input, Select, Textarea } from "@/components/ui/input"
import { Mono, Table, TBody, TD, TH, THead, TR } from "@/components/ui/table"
import { Toggle } from "@/components/ui/toggle"

type Quote = { mint: string; symbol: string; decimals: number; kind?: string }
type PlanRow = { role: string; label: string; publicKey: string | null; buy: number; needSol: number; needQuote?: number; haveQuote?: number; sendQuote?: number; quoteAccount?: string | null }
type Shortfall = { role: string; label: string; publicKey: string | null; send: number; symbol: string; account: string | null }
type Plan = { rows: PlanRow[]; total: number; tipSol: number; useLut: boolean; quote: Quote; custom: boolean; mayhem: boolean; holderReward: boolean; creatorFeeBps: number; totalQuote: number; shortfalls: Shortfall[]; refusal: ApiErrorBody | null; ok: boolean }
type Pair = { mint: string; symbol: string; name?: string | null; decimals: number; source: "sol" | "global" | "quoteControl" | "pumpCoin"; kind: "sol" | "stable" | "stock" | "crypto" | "pump" }
type PoolEntry = { publicKey: string; suffix: string; prefix: string; status: "available" | "used" }
type Job = { status: "idle" | "running" | "done" | "failed"; attempts: number; expectedAttempts: number; rate: number; found: string | null; error: string | null }
type Event = { at: number; stage: string; message: string; signature?: string; mint?: string; link?: string }
type Simulate = { ok: boolean; checks: Array<{ name: string; ok: boolean; detail: string }>; simulation: { ok: boolean; err: unknown; unitsConsumed: number | null; logs: string[] } | null }
type Wallet = { publicKey: string; label: string; role: string }

const n = (v: string, d = 0) => (v.trim() === "" || Number.isNaN(Number(v)) ? d : Number(v))
/** The Pair-with select: SOL first, then the groups in this order. */
const PAIR_GROUPS: Array<{ kind: Pair["kind"]; title: string }> = [{ kind: "stable", title: "Stablecoins" }, { kind: "stock", title: "Tokenized stocks (xStocks)" }, { kind: "crypto", title: "Crypto" }, { kind: "pump", title: "pump.fun coins" }]
const SOL_PAIR: Pair = { mint: "So11111111111111111111111111111111111111112", symbol: "SOL", name: "Solana", decimals: 9, source: "sol", kind: "sol" }
/** Picked buyers → the explicit list the executor takes (lib/launch.ts BuyerGroup.wallets). */
const buyers = (xs: PickedBuyer[]) => xs.map((b) => ({ publicKey: b.publicKey, amount: n(b.amount) }))

export default function LaunchPage() {
  const [f, setF] = useState({ name: "", symbol: "", description: "", twitter: "", telegram: "", website: "", devBuySol: "0.1", sniperGapMs: "400", holderDelayS: "10", holderWindowS: "120", slippage: "15", creatorFeeBps: "" })
  const [mintMode, setMintMode] = useState<"vanity" | "random">("random")
  const [vanityKey, setVanityKey] = useState("")
  const [suffix, setSuffix] = useState("pump")
  const [fundFirst, setFundFirst] = useState(true)
  const [useJito, setUseJito] = useState(true)
  // the wallets: dev = ★ unless changed; three "Pick buyers" groups (snipers / holders under Advanced)
  const [wallets, setWallets] = useState<Wallet[]>([])
  const [balances, setBalances] = useState<Map<string, number>>(new Map())
  const [main, setMain] = useState<string | null>(null)
  const [devWallet, setDevWallet] = useState("")
  const [bundle, setBundle] = useState<PickedBuyer[]>([])
  const [snipers, setSnipers] = useState<PickedBuyer[]>([])
  const [holders, setHolders] = useState<PickedBuyer[]>([])
  const [advanced, setAdvanced] = useState(false)
  // the pair and pump.fun's create options
  const [pairs, setPairs] = useState<Pair[]>([SOL_PAIR])
  const [pairsError, setPairsError] = useState<ApiErrorBody | null>(null)
  const [quoteMint, setQuoteMint] = useState(SOL_PAIR.mint)
  const [mayhem, setMayhem] = useState(false)
  const [holderReward, setHolderReward] = useState(false)
  const [image, setImage] = useState<File | null>(null)
  const [metadataUri, setMetadataUri] = useState("")
  const [pool, setPool] = useState<PoolEntry[]>([])
  const [job, setJob] = useState<Job | null>(null)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [sim, setSim] = useState<Simulate | null>(null)
  const [launchId, setLaunchId] = useState<string | null>(null)
  const [events, setEvents] = useState<Event[]>([])
  const logRef = useRef<HTMLDivElement>(null)
  const { busy, error, run } = useAction()

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((s) => ({ ...s, [k]: e.target.value }))
  // the selected pair: SOL by default; a custom pair trades in its own asset (USDC, a stock, …)
  const pair = pairs.find((p) => p.mint === quoteMint) ?? SOL_PAIR
  const custom = pair.source !== "sol"
  const sym = pair.symbol
  const mayhemAllowed = pair.source === "sol" || pair.source === "global"   // SOL or USDC only (422 mayhem_quote_not_allowed otherwise)
  const feeAllowed = pair.source === "quoteControl" || pair.source === "pumpCoin"   // a stock / crypto / pump-coin pair; SOL and USDC pay pump.fun's schedule
  const dev = devWallet || main
  const form = () => ({
    name: f.name, symbol: f.symbol, description: f.description, twitter: f.twitter, telegram: f.telegram, website: f.website, metadataUri,
    mint: { mode: mintMode, publicKey: mintMode === "vanity" && vanityKey ? vanityKey : undefined },
    quoteMint: custom ? pair.mint : "SOL", mayhemMode: mayhem && mayhemAllowed, holderReward, creatorFeeBps: feeAllowed ? n(f.creatorFeeBps) : 0,
    devWallet: devWallet || undefined, devBuySol: n(f.devBuySol),
    bundle: { count: bundle.length, solEach: 0, wallets: buyers(bundle) },
    snipers: { count: snipers.length, solEach: 0, wallets: buyers(snipers), gapMs: n(f.sniperGapMs, 400) },
    holders: { count: holders.length, solEach: 0, wallets: buyers(holders), delayS: n(f.holderDelayS), windowS: n(f.holderWindowS, 120) },
    fundFirst, useJito, slippage: n(f.slippage, 15),
  })

  const loadWallets = useCallback(async () => {
    const r = await apiFetch<{ wallets: Wallet[]; mainWallet: string | null }>("/api/wallets")
    setWallets(r.wallets); setMain(r.mainWallet)
    if (r.wallets.length) apiFetch<{ rows: Array<{ publicKey: string; native: number }> }>("/api/wallets/balances").then((b) => setBalances(new Map(b.rows.map((x) => [x.publicKey, x.native])))).catch(() => {})
  }, [])
  useEffect(() => { void loadWallets().catch(() => {}) }, [loadWallets])
  const loadPool = () => apiFetch<{ entries: PoolEntry[] }>("/api/vanity/pool").then((r) => setPool(r.entries.filter((e) => e.status === "available")))
  useEffect(() => { void loadPool() }, [])
  // the pairs a coin can be launched in (GET /api/sol/pairs through the server's 10-minute cache)
  useEffect(() => {
    apiFetch<{ pairs: Pair[] }>("/api/launch/pairs")
      .then((r) => { setPairs(r.pairs.some((p) => p.source === "sol") ? r.pairs : [SOL_PAIR, ...r.pairs]); setPairsError(null) })
      .catch((e) => setPairsError(e as ApiErrorBody))
  }, [])

  // funding plan, recomputed as the numbers / buyers / pair / options change (a custom pair reads every wallet's quote balance)
  const planKey = JSON.stringify([f.devBuySol, devWallet, bundle, snipers, holders, useJito, f.slippage, quoteMint, mayhem && mayhemAllowed, holderReward, feeAllowed ? f.creatorFeeBps : ""])
  useEffect(() => {
    const t = setTimeout(() => { apiFetch<Plan>("/api/launch/plan", { json: form() }).then(setPlan).catch(() => {}) }, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planKey])

  // vanity job progress while grinding
  useEffect(() => {
    if (job?.status !== "running") return
    const t = setInterval(async () => {
      const j = await apiFetch<Job>("/api/vanity/status").catch(() => null)
      if (!j) return
      setJob(j)
      if (j.status === "done" && j.found) { setVanityKey(j.found); void loadPool() }
    }, 2000)
    return () => clearInterval(t)
  }, [job?.status])

  // launch log over server-sent events
  useEffect(() => {
    if (!launchId) return
    setEvents([])
    const es = new EventSource(`/api/launch/${launchId}/events`)
    es.onmessage = (m) => { const e = JSON.parse(m.data) as Event; setEvents((xs) => [...xs, e]); if (e.stage === "done" || e.stage === "error") es.close() }
    es.onerror = () => es.close()
    return () => es.close()
  }, [launchId])
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }) }, [events])

  const upload = () => run("upload", async () => {
    if (!image) throw { error: "Pick an image first" }
    const fd = new FormData()
    fd.append("file", image)
    fd.append("name", f.name); fd.append("symbol", f.symbol); fd.append("description", f.description)
    if (f.twitter) fd.append("twitter", f.twitter); if (f.telegram) fd.append("telegram", f.telegram); if (f.website) fd.append("website", f.website)
    const r = await apiFetch<{ metadataUri: string }>("/api/ipfs", { method: "POST", body: fd })
    setMetadataUri(r.metadataUri)
  })
  const grind = () => run("grind", async () => setJob(await apiFetch<Job>("/api/vanity/start", { json: { suffix, caseSensitive: true } })))
  const fundNow = () => run("fund", async () => {
    const r = await apiFetch<{ results: Array<{ publicKey: string; role: string; sent: number; signature?: string; error?: string }> }>("/api/launch/fund", { json: form() })
    setEvents(r.results.map((x) => ({ at: Date.now(), stage: "fund", message: `${x.role} ${short(x.publicKey)}: ${x.error ? `failed: ${x.error}` : x.sent ? `+${x.sent} SOL (${short(x.signature ?? "", 6)})` : "already funded"}` })))
    apiFetch<Plan>("/api/launch/plan", { json: form() }).then(setPlan).catch(() => {})
    void loadWallets()
  })
  const simulate = () => run("simulate", async () => { setSim(null); setSim(await apiFetch<Simulate>("/api/launch/simulate", { json: form() })) })
  const launch = () => run("launch", async () => {
    if (!confirm(`Launch ${f.name} (${f.symbol}) now with ${bundle.length + snipers.length + holders.length} buyer wallet(s)? This sends real transactions.`)) return
    const r = await apiFetch<{ id: string }>("/api/launch", { json: form() })
    setLaunchId(r.id)
  })

  const final = events.find((e) => e.stage === "live" || e.stage === "done")
  const mintOut = events.find((e) => e.mint)?.mint
  const taken = (own: PickedBuyer[]) => new Set([...(dev ? [dev] : []), ...[...bundle, ...snipers, ...holders].filter((b) => !own.some((o) => o.publicKey === b.publicKey)).map((b) => b.publicKey)])

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader><CardTitle>Coin</CardTitle><CardDescription>Image + details go to IPFS first (POST /api/ipfs); the create uses the metadata link.</CardDescription></CardHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name"><Input maxLength={32} value={f.name} onChange={set("name")} /></Field>
            <Field label="Symbol"><Input maxLength={10} value={f.symbol} onChange={set("symbol")} /></Field>
            <Field label="Description" className="sm:col-span-2"><Textarea value={f.description} onChange={set("description")} /></Field>
            <Field label="Twitter"><Input placeholder="https://x.com/…" value={f.twitter} onChange={set("twitter")} /></Field>
            <Field label="Telegram"><Input placeholder="https://t.me/…" value={f.telegram} onChange={set("telegram")} /></Field>
            <Field label="Website" className="sm:col-span-2"><Input placeholder="https://…" value={f.website} onChange={set("website")} /></Field>
            <Field label="Image" hint="png / jpg / gif / webp, up to 4 MB">
              <Input type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={(e) => setImage(e.target.files?.[0] ?? null)} />
            </Field>
            <div className="flex flex-col justify-end gap-1.5">
              <Button variant="secondary" onClick={upload} disabled={!image || !f.name || !f.symbol || busy !== null}>{busy === "upload" ? "Uploading…" : metadataUri ? "Re-upload" : "Upload to IPFS"}</Button>
              {metadataUri ? <a className="truncate font-mono text-xs underline underline-offset-4" href={metadataUri} target="_blank" rel="noreferrer">{metadataUri}</a> : <span className="text-muted-foreground text-xs">no metadata yet (re-upload after changing name / symbol / links)</span>}
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader><CardTitle>Pair & options</CardTitle><CardDescription>What the coin is priced and traded in, and pump.fun&apos;s create options. Fixed at creation.</CardDescription></CardHeader>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Pair with" hint={pairsError ? <span className="text-destructive">{pairsError.error}{pairsError.code ? ` · ${pairsError.code}` : ""}</span> : custom ? `${sym} (${pair.decimals} decimals): buys are paid in ${sym}; every wallet must hold it. Fees stay in SOL.` : "SOL: the ordinary pump.fun coin"}>
              <Select value={quoteMint} onChange={(e) => setQuoteMint(e.target.value)}>
                <option value={SOL_PAIR.mint}>SOL · Solana</option>
                {PAIR_GROUPS.map((g) => {
                  const list = pairs.filter((p) => p.kind === g.kind && p.source !== "sol")
                  return list.length ? <optgroup key={g.kind} label={g.title}>{list.map((p) => <option key={p.mint} value={p.mint}>{p.symbol} · {p.name || short(p.mint, 4)}</option>)}</optgroup> : null
                })}
              </Select>
            </Field>
            {feeAllowed && (
              <Field label="Creator fee (bps)" hint="Your fee on every trade, 100 = 1 %. pump.fun offers 5–100 bps; the API's on-chain max applies. Empty = pump.fun's schedule.">
                <Input inputMode="numeric" placeholder="e.g. 50" value={f.creatorFeeBps} onChange={set("creatorFeeBps")} />
              </Field>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className={`flex flex-col gap-1 rounded-lg border p-3 ${mayhemAllowed ? "" : "opacity-60"}`}>
              <Toggle checked={mayhem && mayhemAllowed} onChange={(v) => mayhemAllowed && setMayhem(v)} label={<span className="font-medium">Mayhem mode</span>} className={mayhemAllowed ? "" : "cursor-not-allowed"} />
              <p className="text-muted-foreground text-xs">pump.fun&apos;s agent trades the coin for 24 h with randomized buys and sells; supply 2 B; a buy past the remaining supply fails unless partial fill.{mayhemAllowed ? "" : ` Not available on a ${sym} pair: SOL or USDC coins only.`}</p>
            </div>
            <div className="flex flex-col gap-1 rounded-lg border p-3">
              <Toggle checked={holderReward} onChange={setHolderReward} label={<span className="font-medium">Holder rewards</span>} />
              <p className="text-muted-foreground text-xs">the creator fee goes to holders, permanently.</p>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader><CardTitle>Dev wallet & mint</CardTitle><CardDescription>The dev wallet creates the coin and makes the dev buy. It is ★ unless you pick another.{custom ? ` Amounts are in ${sym}.` : ""}</CardDescription></CardHeader>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Dev wallet">
              <Select value={devWallet} onChange={(e) => setDevWallet(e.target.value)}>
                <option value="">★ {wallets.find((w) => w.publicKey === main)?.label ?? "main wallet"}{main ? ` · ${chain.fmt(balances.get(main))} SOL` : " (none yet)"}</option>
                {wallets.filter((w) => w.publicKey !== main).map((w) => <option key={w.publicKey} value={w.publicKey}>{w.label} · {short(w.publicKey)} · {chain.fmt(balances.get(w.publicKey))} SOL</option>)}
              </Select>
            </Field>
            <Field label={`Dev buy (${sym})`}><Input inputMode="decimal" value={f.devBuySol} onChange={set("devBuySol")} /></Field>
            <Field label="Slippage (%)"><Input inputMode="numeric" value={f.slippage} onChange={set("slippage")} /></Field>
            <Field label="Mint">
              <Select value={mintMode} onChange={(e) => setMintMode(e.target.value as "vanity" | "random")}><option value="random">random (Keypair.generate)</option><option value="vanity">vanity (from the pool)</option></Select>
            </Field>
            {mintMode === "vanity" && (
              <>
                <Field label="Pool key" hint={`${pool.length} available`}>
                  <Select value={vanityKey} onChange={(e) => setVanityKey(e.target.value)}>
                    <option value="">next available (…pump first)</option>
                    {pool.map((p) => <option key={p.publicKey} value={p.publicKey}>{short(p.publicKey, 6)} · {p.prefix}…{p.suffix}</option>)}
                  </Select>
                </Field>
                <Field label="Grind now" hint={job?.status === "running" ? `${job.attempts.toLocaleString()} / ~${job.expectedAttempts.toLocaleString()} attempts · ${job.rate.toLocaleString()}/s` : job?.status === "failed" ? job.error : job?.status === "done" ? `found ${short(job.found ?? "", 6)}` : "suffix, ≤ 4 chars"}>
                  <div className="flex gap-1"><Input value={suffix} onChange={(e) => setSuffix(e.target.value)} className="w-24" /><Button variant="outline" onClick={grind} disabled={busy !== null || job?.status === "running"}>{job?.status === "running" ? "Grinding…" : "Grind"}</Button></div>
                </Field>
              </>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader><CardTitle>Pick buyers</CardTitle><CardDescription>Tick the wallets that buy in the same Jito bundle as the create (up to 16; 5+ use a lookup table, 4 buyers per transaction) and give each its {sym} amount. Snipers and holders are under Advanced.</CardDescription></CardHeader>
          <WalletPicker title="Bundle" hint="same Jito bundle as the create" wallets={wallets} balances={balances} mainWallet={main} exclude={taken(bundle)} value={bundle} onChange={setBundle} onWalletsChanged={loadWallets} max={16} />
          <button type="button" className="text-muted-foreground hover:text-foreground self-start text-sm underline-offset-4 hover:underline" onClick={() => setAdvanced((v) => !v)}>
            Advanced {advanced ? "▴" : "▾"}{!advanced && (snipers.length || holders.length) ? <span className="ml-2 text-xs">({snipers.length} sniper{snipers.length === 1 ? "" : "s"} · {holders.length} holder{holders.length === 1 ? "" : "s"})</span> : null}
          </button>
          {advanced && (
            <>
              <WalletPicker title="Snipers" hint={<>fired one by one as the bundle lands · gap <Input inputMode="numeric" value={f.sniperGapMs} onChange={set("sniperGapMs")} className="mx-1 inline-block h-6 w-16 px-1.5 text-center font-mono text-xs" aria-label="Sniper gap (ms)" /> ms</>} wallets={wallets} balances={balances} mainWallet={main} exclude={taken(snipers)} value={snipers} onChange={setSnipers} onWalletsChanged={loadWallets} max={50} />
              <WalletPicker title="Holders" hint={<>auto-buys after <Input inputMode="numeric" value={f.holderDelayS} onChange={set("holderDelayS")} className="mx-1 inline-block h-6 w-14 px-1.5 text-center font-mono text-xs" aria-label="Holder delay (s)" /> s, spread over <Input inputMode="numeric" value={f.holderWindowS} onChange={set("holderWindowS")} className="mx-1 inline-block h-6 w-14 px-1.5 text-center font-mono text-xs" aria-label="Holder window (s)" /> s</>} wallets={wallets} balances={balances} mainWallet={main} exclude={taken(holders)} value={holders} onChange={setHolders} onWalletsChanged={loadWallets} max={100} />
            </>
          )}
          <div className="flex flex-wrap gap-4">
            <Toggle checked={useJito} onChange={setUseJito} label="Jito bundle (off = create, then buys one by one)" />
            <Toggle checked={fundFirst} onChange={setFundFirst} label={custom ? `Fund the buyers' SOL reserve from ★ first (${sym} is never moved by this app)` : "Fund the buyers from ★ first"} />
          </div>
        </Card>

        <ApiError error={error} />
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={fundNow} disabled={busy !== null}>{busy === "fund" ? "Funding…" : "Fund from ★"}</Button>
          <Button variant="secondary" onClick={simulate} disabled={busy !== null}>{busy === "simulate" ? "Simulating…" : "Simulate"}</Button>
          <Button onClick={launch} disabled={busy !== null || !f.name || !f.symbol || !metadataUri || (plan !== null && !plan.ok) || (launchId !== null && !events.some((e) => e.stage === "done" || e.stage === "error"))} title={plan && !plan.ok ? "The funding plan is not ok: see the right-hand card" : undefined}>{busy === "launch" ? "Starting…" : "Launch"}</Button>
        </div>

        {sim && (
          <Card className="gap-2">
            <CardTitle>Simulation <Pill tone={sim.ok ? "ok" : "bad"}>{sim.ok ? "all checks pass" : "see below"}</Pill></CardTitle>
            <ul className="flex flex-col gap-1 text-sm">
              {sim.checks.map((c) => <li key={c.name} className="flex gap-2"><span className={c.ok ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}>{c.ok ? "ok" : "fail"}</span><span className="text-muted-foreground w-20 shrink-0">{c.name}</span><span className="break-all">{c.detail}</span></li>)}
            </ul>
            {sim.simulation && !sim.simulation.ok && <pre className="bg-muted overflow-x-auto rounded-md p-2 text-xs">{sim.simulation.logs.join("\n")}</pre>}
          </Card>
        )}

        {(launchId || events.length > 0) && (
          <Card className="gap-2">
            <CardTitle>
              Launch log {launchId && <span className="text-muted-foreground font-normal">{launchId}</span>}
              {mintOut && <a className="ml-2 inline-flex items-center gap-1 text-sm font-normal underline underline-offset-4" href={`https://pump.fun/coin/${mintOut}`} target="_blank" rel="noreferrer">pump.fun/coin/{short(mintOut, 6)} <ExternalLink className="size-3" /></a>}
            </CardTitle>
            <div ref={logRef} className="bg-muted/40 max-h-80 overflow-y-auto rounded-md p-2 font-mono text-xs">
              {events.map((e, i) => (
                <div key={i} className={e.stage === "error" || e.stage === "warning" ? "text-destructive" : e.stage === "live" || e.stage === "done" ? "text-emerald-600 dark:text-emerald-400" : ""}>
                  <span className="text-muted-foreground">{new Date(e.at).toLocaleTimeString()} </span>
                  <span className="text-muted-foreground">[{e.stage}] </span>
                  {e.message}
                  {e.signature && <a className="ml-1 underline underline-offset-4" href={`https://solscan.io/tx/${e.signature}`} target="_blank" rel="noreferrer">tx</a>}
                </div>
              ))}
              {launchId && !events.some((e) => e.stage === "done" || e.stage === "error") && <div className="text-muted-foreground">…</div>}
            </div>
            {final?.link && <a className="text-sm underline underline-offset-4" href={final.link} target="_blank" rel="noreferrer">{final.link}</a>}
          </Card>
        )}
      </div>

      <div className="flex flex-col gap-4">
        <Card className="gap-3">
          <CardHeader>
            <CardTitle>Funding plan {plan && (plan.ok ? <Pill tone="ok">ok</Pill> : <Pill tone="bad">not ok</Pill>)}</CardTitle>
            <CardDescription>
              {plan?.custom
                ? <>Buys are paid in {plan.quote.symbol}: each wallet must already hold its buy + slippage (this app never moves {plan.quote.symbol}). SOL per wallet: 0.01 reserve + API-fee reserve (our fee is still SOL). Dev adds the Jito tip{plan.useLut ? " and 0.02 SOL table rent (refunded)" : ""}.</>
                : <>Per wallet: its buy + 0.5 % API fee + 0.01 SOL reserve. Dev adds the Jito tip{plan?.useLut ? " and 0.02 SOL table rent (refunded)" : ""}.</>}
            </CardDescription>
          </CardHeader>
          {plan ? (
            <>
              {plan.refusal && <ApiError error={plan.refusal} />}
              <Table>
                <THead><TR><TH>Wallet</TH><TH>Buy</TH>{plan.custom && <TH>Holds</TH>}<TH>Needs SOL</TH></TR></THead>
                <TBody>
                  {plan.rows.map((r, i) => (
                    <TR key={i}>
                      <TD><Pill className="mr-1">{r.role}</Pill>{r.publicKey ? <span className="text-xs">{r.label} <Mono className="text-muted-foreground">{short(r.publicKey)}</Mono></span> : <span className="text-muted-foreground text-xs">new</span>}</TD>
                      <TD>{r.buy} {plan.quote.symbol}</TD>
                      {plan.custom && <TD className={r.sendQuote ? "text-destructive" : ""}>{r.haveQuote ?? 0} / {r.needQuote ?? 0} {plan.quote.symbol}</TD>}
                      <TD>{r.needSol.toFixed(4)} SOL</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
              {plan.shortfalls.length > 0 && (
                <div className="border-destructive/40 bg-destructive/5 flex flex-col gap-1 rounded-lg border px-3 py-2 text-xs">
                  <span className="text-destructive font-medium">Short of {plan.quote.symbol} ({plan.shortfalls.length} wallet{plan.shortfalls.length > 1 ? "s" : ""}): the launch is refused until they hold it.</span>
                  {plan.shortfalls.map((s, i) => (
                    <div key={i} className="break-all">
                      {s.publicKey
                        ? <>send <span className="font-medium">{s.send} {s.symbol}</span> to <Mono>{s.publicKey}</Mono> <span className="text-muted-foreground">({s.label})</span></>
                        : <>{s.label}: create the wallet on the Wallets page first, then send it <span className="font-medium">{s.send} {s.symbol}</span></>}
                    </div>
                  ))}
                </div>
              )}
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Total SOL from ★</span><span className="font-medium">{plan.total.toFixed(4)} SOL</span></div>
              {plan.custom && <div className="flex justify-between text-sm"><span className="text-muted-foreground">Total {plan.quote.symbol} across the wallets (buys + slippage)</span><span className="font-medium">{plan.totalQuote} {plan.quote.symbol}</span></div>}
              <p className="text-muted-foreground text-xs">
                Tip {plan.tipSol} SOL inside the create transaction{plan.useLut ? "; lookup table in use" : ""}.
                {plan.mayhem ? " Mayhem mode." : ""}{plan.holderReward ? " Holder rewards." : ""}{plan.creatorFeeBps ? ` Creator fee ${plan.creatorFeeBps} bps.` : ""}
              </p>
            </>
          ) : <p className="text-muted-foreground text-sm">…</p>}
        </Card>
        <Card className="gap-2 text-sm">
          <CardTitle>How it runs</CardTitle>
          <ol className="text-muted-foreground list-decimal space-y-1 pl-4 text-xs">
            <li>The wallets you picked (dev = ★ unless changed); every key must have its file</li>
            <li>Mint key (pool or random), saved to the pool</li>
            <li>Funding transfers from ★ (optional)</li>
            <li>Lookup table for 5–16 buyers (POST /api/sol/lut)</li>
            <li>POST /api/sol/trade-local (array) → sign → POST /api/sol/bundle → poll</li>
            <li>Snipers (POST /api/sol/send each), then holders over the window</li>
            <li>Record in launches.json; table rent refunded</li>
          </ol>
        </Card>
      </div>
    </div>
  )
}
