"use client"

/**
 * Trading: pick a coin (my launches | paste), see every wallet with its balance and the coin, and trade from the row:
 * [amount][Buy] · [25%][50%][100%] sell, acting at once (a toast carries the result or the API's error verbatim). Select
 * rows → a bar: Buy [x] each · Sell 25 / 50 / 100 % of selected · Timed sell ▾. Live trades on the right; creator fees
 * (pump.fun) as one small row. This file is the same in the pump.fun and pons starters; lib/chain.ts holds what differs.
 */
import * as React from "react"
import { ExternalLink, RefreshCw } from "lucide-react"
import { FailureBox } from "@/components/failure"
import { Button } from "@/components/ui/button"
import { Checkbox, Input, Select } from "@/components/ui/input"
import { Pill } from "@/components/ui/pill"
import { Mono, Table, TBody, TD, TH, THead, TR } from "@/components/ui/table"
import { toast, toastFailure } from "@/components/ui/toast"
import { del, failureOf, get, post, readChosenCoin, subscribe, writeChosenCoin, type Failure } from "@/lib/api"
import { chain } from "@/lib/chain"
import { DEMO, TAB_NOTE } from "@/lib/browser/demo"

type Launch = { id: string; name: string; symbol: string; mint?: string | null; token?: string | null; status: string; createdAt: string }
type Wallet = { publicKey: string; label: string; role: string }
type Row = { publicKey: string; native: number; tokens?: number }
/** GET /api/trading/token, either starter: name / symbol / venue, plus pump.fun's quote + Mayhem flags or pons's curve state. */
type Token = { name?: string | null; symbol?: string | null; venue?: string; quote?: { symbol: string }; custom?: boolean; mayhem?: { enabled: boolean }; holderReward?: boolean; creatorFeeBps?: number; graduated?: boolean; curveState?: Record<string, number> | null }
type Trade = { signature?: string; hash?: string; type: "buy" | "sell"; trader: string; sol?: number; eth?: number; tokens: number; timestamp: number; ours: string | null }
type Timer = { id: string; publicKeys: string[]; percent: number; dueAt: number; status: string; error?: string; result?: Array<{ publicKey: string; signature?: string; hash?: string; error?: string; skipped?: string }> }
/** A trade's answer, either starter: `signature` (Solana) or `hash` (EVM); `expected.quoteAmount` or `expected.eth`. */
type Result = { publicKey: string; signature?: string; hash?: string; confirmed?: boolean; expected?: { tokens: number; quoteAmount?: number; eth?: number }; quote?: { symbol: string }; error?: string; code?: string; skipped?: string }
type Fees = { creator: string; sol: number }

const fmtTokens = (n: number | undefined) => (n === undefined ? "–" : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n.toLocaleString("en-US", { maximumFractionDigits: n < 1 ? 4 : 0 }))
const ago = (ms: number) => { const s = Math.max(0, Math.round((Date.now() - ms) / 1000)); return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h` }
const countdown = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` }
const txOf = (x: { signature?: string; hash?: string }) => x.signature ?? x.hash
const nativeOf = (t: Trade) => t.sol ?? t.eth ?? 0

export default function TradingPage() {
  const [launches, setLaunches] = React.useState<Launch[]>([])
  const [coin, setCoin] = React.useState("")
  const [token, setToken] = React.useState<Token | null>(null)
  const [wallets, setWallets] = React.useState<Wallet[]>([])
  const [main, setMain] = React.useState<string | null>(null)
  const [rows, setRows] = React.useState<Map<string, Row>>(new Map())
  const [failure, setFailure] = React.useState<Failure | null>(null)
  const [busy, setBusy] = React.useState<string | null>(null)
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [buyAmt, setBuyAmt] = React.useState<Record<string, string>>({})
  const [eachBuy, setEachBuy] = React.useState(chain.defaultBuy)
  const [partialFill, setPartialFill] = React.useState(false)
  const [timers, setTimers] = React.useState<Timer[]>([])
  const [timerMin, setTimerMin] = React.useState("5")
  const [timerPct, setTimerPct] = React.useState("50")
  const [now, setNow] = React.useState(Date.now())
  const [trades, setTrades] = React.useState<Trade[]>([])
  const [feed, setFeed] = React.useState<"off" | "connecting" | "live">("off")
  const [fees, setFees] = React.useState<Fees | null>(null)

  const valid = chain.isCoin(coin)
  const cp = chain.coinParam
  const q = (c: string) => `${cp}=${encodeURIComponent(c)}`
  const sym = token?.quote?.symbol ?? chain.symbol
  const mayhem = chain.features.mayhem && token?.mayhem?.enabled === true
  const picked = [...selected].filter((pk) => wallets.some((w) => w.publicKey === pk))
  const row = (pk: string) => rows.get(pk.toLowerCase())
  const last = trades.find((t) => t.tokens > 0 && nativeOf(t) > 0)
  const price = last ? nativeOf(last) / last.tokens : null

  // my launches + the coin remembered from last time
  React.useEffect(() => {
    get<{ launches: Launch[] }>("/api/launch").then((r) => setLaunches(r.launches.filter((l) => l.mint || l.token))).catch(() => {})
    const c = readChosenCoin()
    if (c?.coin) setCoin(c.coin)
  }, [])
  React.useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])

  const load = React.useCallback(async () => {
    if (!valid) return
    try {
      const [f, b] = await Promise.all([get<{ wallets: Wallet[]; mainWallet: string | null }>("/api/wallets"), get<{ rows: Row[] }>(`/api/wallets/balances?${q(coin)}`)])
      setWallets(f.wallets); setMain(f.mainWallet)
      setRows(new Map(b.rows.map((r) => [r.publicKey.toLowerCase(), r])))
      setFailure(null)
    } catch (e) { setFailure(failureOf(e)) }
    if (chain.features.creatorFees) get<Fees>(`/api/trading/creator-fees?${q(coin)}`).then(setFees).catch(() => setFees(null))
  }, [coin, valid]) // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { void load() }, [load])

  // the coin: name, symbol, venue, flags; remembered for the Wallets page's balance column
  React.useEffect(() => {
    setToken(null); setPartialFill(false); setSelected(new Set())
    if (!valid) return
    get<Token>(`/api/trading/token?${q(coin)}`).then((t) => { setToken(t); writeChosenCoin({ coin, symbol: t.symbol ?? undefined }) }).catch(() => { setToken(null); writeChosenCoin({ coin }) })
  }, [coin, valid]) // eslint-disable-line react-hooks/exhaustive-deps

  // timers: the list every 5 s while one is pending
  const loadTimers = React.useCallback(() => { if (valid) get<{ timers: Timer[] }>(`/api/trading/timers?${q(coin)}`).then((r) => setTimers(r.timers)).catch(() => {}) }, [coin, valid]) // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { loadTimers() }, [loadTimers])
  React.useEffect(() => {
    if (!timers.some((t) => t.status === "pending" || t.status === "running")) return
    const i = setInterval(loadTimers, 5000)
    return () => clearInterval(i)
  }, [timers, loadTimers])

  // live trades: server-sent events relaying the API websocket
  React.useEffect(() => {
    setTrades([])
    if (!valid) { setFeed("off"); return }
    setFeed("connecting")
    return subscribe<{ type: "initial" | "snapshot"; trades: Trade[] } | { type: "trade"; trade: Trade }>(`/api/trading/feed?${q(coin)}`, (e) => {
      if (e.type === "trade") setTrades((xs) => [e.trade, ...xs].slice(0, 200))
      else { setTrades(e.trades); setFeed("live") }
    }, undefined, () => setFeed("connecting"))
  }, [coin, valid]) // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (name: string, fn: () => Promise<void>) => {
    setBusy(name)
    try { await fn() } catch (e) { toastFailure(failureOf(e)) } finally { setBusy(null) }
  }
  const toggle = (pk: string) => setSelected((s) => { const n = new Set(s); if (n.has(pk)) n.delete(pk); else n.add(pk); return n })
  const label = (pk: string) => wallets.find((w) => w.publicKey === pk)?.label ?? chain.short(pk)
  const link = (sig: string) => <a className="underline underline-offset-4" href={chain.explorerTx(sig)} target="_blank" rel="noreferrer"><Mono className="text-xs">{chain.short(sig)}</Mono></a>
  const amountOf = (r: Result) => r.expected?.quoteAmount ?? r.expected?.eth

  // ── trades: act at once, one toast per result ───────────────────────────
  const buy = (pk: string, amount: string) => run(`buy:${pk}`, async () => {
    const a = Number(amount)
    if (!(a > 0)) throw { error: `Enter the ${sym} amount to buy with` }
    const r = await post<Result>("/api/trading/buy", { publicKey: pk, [cp]: coin, amount: a, ...(mayhem && partialFill ? { partialFill: true } : {}) })
    const s = txOf(r)
    toast({ tone: "ok", title: `${label(pk)} bought ${r.expected ? `~${fmtTokens(r.expected.tokens)} tokens` : ""} for ${amountOf(r) ?? a} ${r.quote?.symbol ?? sym}`, detail: <>{r.confirmed === false ? "sent, not confirmed yet · " : ""}{s ? link(s) : null}</> })
    await load()
  })
  const sell = (pk: string, percent: number) => run(`sell:${pk}:${percent}`, async () => {
    const r = await post<Result>("/api/trading/sell", { publicKey: pk, [cp]: coin, percent })
    const s = txOf(r)
    toast({ tone: "ok", title: `${label(pk)} sold ${percent}%${r.expected ? ` · ${fmtTokens(r.expected.tokens)} tokens for ${amountOf(r)} ${r.quote?.symbol ?? sym}` : ""}`, detail: <>{r.confirmed === false ? "sent, not confirmed yet · " : ""}{s ? link(s) : null}</> })
    await load()
  })
  const buySelected = () => run("buy-all", async () => {
    const a = Number(eachBuy)
    if (!(a > 0)) throw { error: `Enter the ${sym} amount each wallet buys with` }
    const out: Result[] = []
    for (const pk of picked) {
      try { out.push(await post<Result>("/api/trading/buy", { publicKey: pk, [cp]: coin, amount: a, ...(mayhem && partialFill ? { partialFill: true } : {}) })) }
      catch (e) { const f = failureOf(e); out.push({ publicKey: pk, error: f.error, code: f.code }) }
    }
    report(`Buy ${a} ${sym} each`, out)
    await load()
  })
  const sellSelected = (percent: number) => run(`sell-all:${percent}`, async () => {
    const r = await post<{ results: Result[] }>("/api/trading/sell-all", { publicKeys: picked, [cp]: coin, percent })
    report(`Sell ${percent}% of selected`, r.results)
    await load()
  })
  const report = (title: string, results: Result[]) => {
    const failed = results.filter((r) => r.error).length
    toast({
      tone: failed ? "error" : "ok", sticky: failed > 0, title: `${title}: ${results.length - failed}/${results.length} done`,
      detail: (
        <span className="flex flex-col gap-0.5">
          {results.map((r) => (
            <span key={r.publicKey} className="flex flex-wrap items-center gap-1.5">
              <span>{label(r.publicKey)}</span>
              {r.error ? <span className="text-destructive">{r.error}{r.code ? ` · ${r.code}` : ""}</span> : r.skipped ? <span>skipped: {r.skipped}</span> : <span>{r.expected ? `${fmtTokens(r.expected.tokens)} tokens · ${amountOf(r)} ${r.quote?.symbol ?? sym}` : "done"}</span>}
              {txOf(r) ? link(txOf(r)!) : null}
            </span>
          ))}
        </span>
      ),
    })
  }
  const addTimer = () => run("timer", async () => {
    await post("/api/trading/timers", { [cp]: coin, publicKeys: picked, percent: Number(timerPct) || 100, minutes: Number(timerMin) || 0 })
    toast({ tone: "ok", title: `Timed sell set: ${timerPct}% from ${picked.length} wallet${picked.length === 1 ? "" : "s"} in ${timerMin} min`, detail: DEMO ? TAB_NOTE : "Kept in the server's memory; a restart forgets it." })
    loadTimers()
  })
  const cancelTimer = (id: string) => run(`cancel:${id}`, async () => { await del(`/api/trading/timers?id=${encodeURIComponent(id)}`); loadTimers() })
  const claim = () => run("claim", async () => {
    const r = await post<{ creator: string; signature: string; confirmed: boolean }>("/api/trading/creator-fees", { [cp]: coin })
    toast({ tone: "ok", title: `Creator fees claimed to ${chain.short(r.creator)}`, detail: <>{r.confirmed ? "confirmed · " : "sent · "}{link(r.signature)}</> })
    await load()
  })

  const pendingTimers = timers.filter((t) => t.status === "pending" || t.status === "running").length
  const badges: React.ReactNode[] = []
  if (token?.venue) badges.push(<Pill key="venue">{token.venue}</Pill>)
  if (token?.custom && token.quote) badges.push(<Pill key="pair" title={`priced and traded in ${token.quote.symbol}; wallets must hold it. Fees are still ${chain.symbol}.`}>pair · {token.quote.symbol}</Pill>)
  if (mayhem) badges.push(<Pill key="mayhem" tone="warn" title="pump.fun's agent trades this coin for its first 24 h; a buy past the remaining supply fails unless partial fill">Mayhem</Pill>)
  if (token?.holderReward) badges.push(<Pill key="hr" tone="ok" title="the creator fee goes to the holders">holder rewards</Pill>)
  if (token?.creatorFeeBps) badges.push(<Pill key="fee">creator fee {token.creatorFeeBps} bps</Pill>)
  if (token?.graduated) badges.push(<Pill key="grad" tone="ok">graduated</Pill>)
  if (token?.curveState?.bondingProgressPct !== undefined) badges.push(<Pill key="curve">curve {token.curveState.bondingProgressPct.toFixed(1)} %</Pill>)
  if (token?.curveState?.snipeTaxBps) badges.push(<Pill key="tax" tone="warn">snipe tax {token.curveState.snipeTaxBps} bps</Pill>)

  return (
    <div className="flex flex-col gap-4">
      {/* coin picker + header */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">Coin</span>
        <Select value={launches.find((l) => (l.mint ?? l.token) === coin)?.id ?? ""} onChange={(e) => setCoin(launches.find((l) => l.id === e.target.value)?.mint ?? launches.find((l) => l.id === e.target.value)?.token ?? "")} className="w-60 text-xs" aria-label="My launches">
          <option value="">my launches…</option>
          {launches.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.symbol}) · {l.status}</option>)}
        </Select>
        <Input placeholder={`or paste a ${chain.coinNoun}`} value={coin} onChange={(e) => setCoin(e.target.value.trim())} className="min-w-64 flex-1 font-mono text-xs" />
        <Button variant="outline" size="icon-sm" aria-label="Refresh" onClick={() => void load()} disabled={!valid || !!busy}><RefreshCw /></Button>
      </div>
      {valid ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold">{token?.name ?? chain.short(coin)}</span>
          {token?.symbol ? <span className="text-muted-foreground">· {token.symbol}</span> : null}
          {price !== null ? <span className="text-muted-foreground font-mono text-xs" title="from the latest trade in the feed">· last {price.toPrecision(3)} {sym}/token</span> : null}
          {badges}
          <span className="ml-auto flex flex-wrap items-center gap-3 text-xs">
            {chain.coinLinks(coin).map((l) => <a key={l.label} className="inline-flex items-center gap-1 underline underline-offset-4" href={l.href} target="_blank" rel="noreferrer">{l.label} <ExternalLink className="size-3" /></a>)}
          </span>
        </div>
      ) : <p className="text-muted-foreground text-sm">Pick one of your launches or paste a {chain.coinNoun}. Every wallet then shows its balance of the coin and can buy or sell from its row.</p>}
      <FailureBox failure={failure} />

      {valid ? (
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="flex flex-col gap-3">
            <Table>
              <THead>
                <TR>
                  <TH className="w-8"><Checkbox checked={wallets.length > 0 && picked.length === wallets.length} onChange={(e) => setSelected(e.target.checked ? new Set(wallets.map((w) => w.publicKey)) : new Set())} aria-label="Select all" /></TH>
                  <TH>Wallet</TH>
                  <TH className="text-right">{chain.symbol}</TH>
                  <TH className="text-right">Tokens</TH>
                  <TH className="text-right">Value</TH>
                  <TH>
                    <span className="inline-flex items-center gap-2">Buy ({sym})
                      {mayhem ? <label className="inline-flex items-center gap-1 normal-case" title="Mayhem coins: a buy past the remaining supply takes what is left instead of failing"><Checkbox checked={partialFill} onChange={(e) => setPartialFill(e.target.checked)} className="size-3" /> partial fill</label> : null}
                    </span>
                  </TH>
                  <TH>Sell</TH>
                </TR>
              </THead>
              <TBody>
                {wallets.length === 0 ? <TR><TD colSpan={7} className="text-muted-foreground py-6 text-center">No wallets yet: create some on the Wallets page.</TD></TR> : null}
                {wallets.map((w) => {
                  const r = row(w.publicKey)
                  const held = (r?.tokens ?? 0) > 0
                  return (
                    <TR key={w.publicKey} data-selected={selected.has(w.publicKey)} className={held ? "" : "text-muted-foreground"}>
                      <TD><Checkbox checked={selected.has(w.publicKey)} onChange={() => toggle(w.publicKey)} aria-label={`Select ${w.label}`} /></TD>
                      <TD><span className={w.publicKey === main ? "text-foreground font-medium" : "text-foreground"}>{w.publicKey === main ? "★ " : ""}{w.label}</span> <Mono className="text-muted-foreground ml-1 text-xs">{chain.short(w.publicKey)}</Mono></TD>
                      <TD className="text-right font-mono text-xs">{chain.fmt(r?.native)}</TD>
                      <TD className="text-right font-mono text-xs">{fmtTokens(r?.tokens)}</TD>
                      <TD className="text-right font-mono text-xs">{price !== null && r?.tokens ? `${(r.tokens * price).toFixed(4)} ${sym}` : "–"}</TD>
                      <TD>
                        <span className="inline-flex items-center gap-1">
                          <Input inputMode="decimal" className="h-7 w-20 font-mono text-xs" value={buyAmt[w.publicKey] ?? chain.defaultBuy} onChange={(e) => setBuyAmt((s) => ({ ...s, [w.publicKey]: e.target.value }))} aria-label={`${w.label} buy amount`} />
                          <Button size="xs" variant="outline" onClick={() => void buy(w.publicKey, buyAmt[w.publicKey] ?? chain.defaultBuy)} disabled={!!busy}>{busy === `buy:${w.publicKey}` ? "…" : "Buy"}</Button>
                        </span>
                      </TD>
                      <TD>
                        <span className="inline-flex gap-1">
                          {[25, 50, 100].map((p) => <Button key={p} size="xs" variant="outline" onClick={() => void sell(w.publicKey, p)} disabled={!!busy || !held} title={held ? `Sell ${p}% of ${w.label}'s tokens now` : "holds none"}>{busy === `sell:${w.publicKey}:${p}` ? "…" : `${p}%`}</Button>)}
                        </span>
                      </TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>

            {picked.length > 0 ? (
              <div className="bg-background/95 sticky bottom-3 z-30 flex flex-col gap-2 rounded-xl border p-3 shadow-lg backdrop-blur">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{picked.length} selected</span>
                  <button type="button" className="text-muted-foreground hover:text-foreground text-xs underline-offset-4 hover:underline" onClick={() => setSelected(new Set())}>clear</button>
                  <span className="text-muted-foreground mx-1">·</span>
                  <span className="text-muted-foreground">Buy</span>
                  <Input inputMode="decimal" value={eachBuy} onChange={(e) => setEachBuy(e.target.value)} className="h-8 w-24 font-mono" aria-label="Buy amount each" />
                  <span className="text-muted-foreground">{sym} each</span>
                  <Button size="sm" onClick={buySelected} disabled={!!busy}>{busy === "buy-all" ? "Buying…" : `Buy with ${picked.length}`}</Button>
                  <span className="text-muted-foreground mx-1">·</span>
                  <span className="text-muted-foreground">Sell</span>
                  {[25, 50, 100].map((p) => <Button key={p} size="sm" variant={p === 100 ? "destructive" : "outline"} onClick={() => void sellSelected(p)} disabled={!!busy}>{busy === `sell-all:${p}` ? "…" : `${p}%`}</Button>)}
                  <span className="text-muted-foreground">of selected</span>
                </div>
                <details className="text-sm">
                  <summary className="text-muted-foreground hover:text-foreground cursor-pointer select-none">Timed sell ▾{pendingTimers ? <span className="ml-2 text-xs">({pendingTimers} pending)</span> : null}</summary>
                  <div className="mt-2 flex flex-wrap items-center gap-2 border-t pt-2">
                    <span className="text-muted-foreground">In</span>
                    <Input inputMode="numeric" value={timerMin} onChange={(e) => setTimerMin(e.target.value)} className="h-8 w-16 font-mono" aria-label="Minutes" />
                    <span className="text-muted-foreground">min sell</span>
                    <Input inputMode="numeric" value={timerPct} onChange={(e) => setTimerPct(e.target.value)} className="h-8 w-16 font-mono" aria-label="Percent" />
                    <span className="text-muted-foreground">% from the {picked.length} selected</span>
                    <Button size="sm" variant="outline" onClick={addTimer} disabled={!!busy}>Add</Button>
                  </div>
                </details>
              </div>
            ) : null}

            {timers.length > 0 ? (
              <div className="flex flex-col gap-1 text-sm">
                <div className="flex items-center justify-between text-xs"><span className="text-muted-foreground">{DEMO ? "Timed sells (kept in this browser; keep this tab open)" : "Timed sells (server memory; a restart forgets them)"}</span><button type="button" className="text-muted-foreground hover:text-foreground underline-offset-4 hover:underline" onClick={() => void del("/api/trading/timers").then(loadTimers)}>clear finished</button></div>
                {timers.map((t) => (
                  <div key={t.id} className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-1.5">
                    <Pill tone={t.status === "done" ? "ok" : t.status === "error" ? "error" : t.status === "pending" ? "warn" : "muted"}>{t.status}</Pill>
                    <span>sell {t.percent}% from {t.publicKeys.length} wallet{t.publicKeys.length === 1 ? "" : "s"}</span>
                    {t.status === "pending" ? <Mono className="text-xs">in {countdown(t.dueAt - now)}</Mono> : null}
                    {t.error ? <span className="text-destructive text-xs">{t.error}</span> : null}
                    {t.result ? <span className="text-muted-foreground text-xs">{t.result.filter((r) => txOf(r)).length} sold · {t.result.filter((r) => r.error).length} failed{t.result.filter((r) => r.error).map((r) => ` · ${chain.short(r.publicKey)}: ${r.error}`).join("")}</span> : null}
                    {t.status === "pending" ? <Button size="xs" variant="ghost" className="ml-auto" onClick={() => void cancelTimer(t.id)} disabled={!!busy}>cancel</Button> : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          {/* right column */}
          <div className="flex flex-col gap-3">
            {chain.features.creatorFees ? (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                <span className="text-muted-foreground">Creator fees</span>
                <span className="font-mono text-xs">{fees ? `${fees.sol.toFixed(4)} ${chain.symbol} unclaimed · ${chain.short(fees.creator)}` : "no creator known for this coin"}</span>
                <Button size="xs" variant="outline" className="ml-auto" onClick={claim} disabled={!fees || fees.sol <= 0 || !!busy}>{busy === "claim" ? "Claiming…" : "Claim"}</Button>
              </div>
            ) : null}
            <div className="flex flex-col gap-1 rounded-lg border p-3">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">Live trades</span>
                <span className="text-muted-foreground text-xs">{feed === "connecting" ? "connecting…" : trades.length === 0 ? "no trades yet" : `${trades.length} trade${trades.length === 1 ? "" : "s"}`}</span>
              </div>
              <div className="flex max-h-[32rem] flex-col gap-0.5 overflow-y-auto text-xs">
                {feed === "live" && trades.length === 0 ? <span className="text-muted-foreground py-2">Listening. Trades on this coin show up here as they land.</span> : null}
                {trades.map((t) => {
                  const id = txOf(t) ?? `${t.trader}-${t.timestamp}`
                  return (
                    <div key={id} className={`flex items-center gap-2 rounded px-1.5 py-1 ${t.ours ? "bg-muted" : ""}`}>
                      <span className={`w-7 ${t.type === "buy" ? "text-ok" : "text-destructive"}`}>{t.type}</span>
                      <span className="w-20 font-mono">{nativeOf(t).toFixed(4)}</span>
                      {txOf(t) ? <a className="font-mono underline-offset-4 hover:underline" href={chain.explorerTx(txOf(t)!)} target="_blank" rel="noreferrer">{chain.short(t.trader)}</a> : <span className="font-mono">{chain.short(t.trader)}</span>}
                      {t.ours ? <Pill className="h-5">{t.ours.split(" · ")[0]}</Pill> : null}
                      <span className="text-muted-foreground ml-auto">{ago(t.timestamp)}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
