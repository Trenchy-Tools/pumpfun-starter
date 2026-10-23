"use client"

/**
 * Wallets: one list. `+ New wallet` (× N), `Import ▾`, search; rows ☐ · ★/☆ · label (click to rename) · address (copy) ·
 * balance · coin balance when a coin is chosen · [Fund] [Key]. Select rows → a bar: Amount each · Fund from ★ · Fund via
 * exchange ▾ · Gather to ★ · Close empty token accounts (Solana) · Export keys · Archive. Keys are files in the folder.
 * This file is the same in the pump.fun and pons starters; lib/chain.ts holds what differs.
 */
import * as React from "react"
import { Check, Copy, ExternalLink, RefreshCw, X } from "lucide-react"
import { FailureBox } from "@/components/failure"
import { Button } from "@/components/ui/button"
import { Checkbox, Input, Select } from "@/components/ui/input"
import { Pill } from "@/components/ui/pill"
import { Mono, Table, TBody, TD, TH, THead, TR } from "@/components/ui/table"
import { toast, toastFailure } from "@/components/ui/toast"
import { copyText, downloadText, failureOf, failureText, get, post, readChosenCoin, walletsChanged, writeChosenCoin, type ChosenCoin, type Failure } from "@/lib/api"
import { chain } from "@/lib/chain"

type Wallet = { publicKey: string; label: string; role: string; createdAt: string; file: string }
type Folder = { dir: string; wallets: Wallet[]; mainWallet: string | null; archived: number; missing: Array<{ publicKey: string; label: string }> }
type Row = { publicKey: string; native: number; tokens?: number }
type Venues = { exchange: string; venues: Record<string, { status: string; reason?: string; default?: boolean }> }
/** One exchange leg, as either starter's fund-exchange route answers it (`signature` on Solana, `depositHash` on EVM). */
type Leg = { publicKey: string; transferId?: string; status?: string; venue?: string | null; error?: string; code?: string; receipt?: string; signature?: string; depositHash?: string }
type Sent = { publicKey: string; signature?: string; hash?: string; error?: string; code?: string; skipped?: string; recovered?: number; eth?: number }

const ROLE_TAGS = ["trader", "bundle", "sniper", "holder"] as const
const LEG_FINAL = ["completed", "failed", "expired", "refunded", "cancelled"]

export default function WalletsPage() {
  const [folder, setFolder] = React.useState<Folder | null>(null)
  const [rows, setRows] = React.useState<Map<string, Row>>(new Map())
  const [coin, setCoin] = React.useState<ChosenCoin | null>(null)
  const [failure, setFailure] = React.useState<Failure | null>(null)
  const [busy, setBusy] = React.useState<string | null>(null)
  const [search, setSearch] = React.useState("")
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [venues, setVenues] = React.useState<Venues | null>(null)
  const [legs, setLegs] = React.useState<Leg[]>([])

  // toolbar
  const [newCount, setNewCount] = React.useState("1")
  const [importOpen, setImportOpen] = React.useState(false)
  const [importKey, setImportKey] = React.useState("")
  // per-row panels
  const [editing, setEditing] = React.useState<{ publicKey: string; label: string; role: string } | null>(null)
  const [funding, setFunding] = React.useState<{ publicKey: string; amount: string } | null>(null)
  const [shownKey, setShownKey] = React.useState<{ publicKey: string; privateKey: string } | null>(null)
  // selection bar
  const [each, setEach] = React.useState(chain.defaultEach)
  const [exchangeOpen, setExchangeOpen] = React.useState(false)
  const [mode, setMode] = React.useState<"float" | "fixed" | "private">("float")
  const [venue, setVenue] = React.useState("random")

  const main = folder?.mainWallet ?? null
  const wallets = folder?.wallets ?? []
  const q = search.trim().toLowerCase()
  const shown = q ? wallets.filter((w) => w.label.toLowerCase().includes(q) || w.publicKey.toLowerCase().includes(q)) : wallets
  const picked = [...selected].filter((pk) => wallets.some((w) => w.publicKey === pk))
  const row = (pk: string) => rows.get(pk.toLowerCase())

  React.useEffect(() => { setCoin(readChosenCoin()) }, [])

  const load = React.useCallback(async (withBalances = true) => {
    try {
      const f = await get<Folder>("/api/wallets")
      setFolder(f)
      setFailure(null)
      if (withBalances && f.wallets.length) {
        const c = readChosenCoin()
        const r = await get<{ rows: Row[] }>(`/api/wallets/balances${c?.coin ? `?${chain.coinParam}=${encodeURIComponent(c.coin)}` : ""}`).catch((e) => { setFailure(failureOf(e)); return { rows: [] as Row[] } })
        setRows(new Map(r.rows.map((x) => [x.publicKey.toLowerCase(), x])))
      }
    } catch (e) {
      setFailure(failureOf(e))
    }
  }, [])
  React.useEffect(() => { void load() }, [load])
  React.useEffect(() => { get<Venues>("/api/transfer/venues").then(setVenues).catch(() => setVenues(null)) }, [])

  // follow exchange legs until they are final (GET /api/transfer/:id)
  React.useEffect(() => {
    const open = legs.filter((l) => l.transferId && !LEG_FINAL.includes(l.status ?? "") && l.status !== "sent-final")
    if (!open.length) return
    const t = setTimeout(async () => {
      const next = await Promise.all(legs.map(async (l) => {
        if (!open.includes(l)) return l
        const s = await get<{ status: string; venue: string | null; receipt?: string; reason?: string }>(`/api/transfer/${l.transferId}`).catch(() => null)
        return s ? { ...l, status: s.status, venue: s.venue ?? l.venue, receipt: s.receipt ?? l.receipt, error: s.reason ?? l.error } : l
      }))
      setLegs(next)
    }, 5000)
    return () => clearTimeout(t)
  }, [legs])

  const run = async (name: string, fn: () => Promise<void>) => {
    setBusy(name)
    try { await fn() } catch (e) { toastFailure(failureOf(e)) } finally { setBusy(null) }
  }
  const changed = async () => { await load(); walletsChanged() }
  const toggle = (pk: string) => setSelected((s) => { const n = new Set(s); if (n.has(pk)) n.delete(pk); else n.add(pk); return n })
  const tx = (x: Sent) => x.signature ?? x.hash
  const sentLines = (results: Sent[], word: (x: Sent) => React.ReactNode) => (
    <span className="flex flex-col gap-0.5">
      {results.map((x) => (
        <span key={x.publicKey} className="flex flex-wrap items-center gap-1.5">
          <Mono className="text-xs">{chain.short(x.publicKey)}</Mono>
          {x.error ? <span className="text-destructive">{x.error}{x.code ? ` · ${x.code}` : ""}</span> : x.skipped ? <span>{x.skipped}</span> : word(x)}
          {tx(x) ? <a className="underline underline-offset-4" href={chain.explorerTx(tx(x)!)} target="_blank" rel="noreferrer"><Mono className="text-xs">{chain.short(tx(x)!)}</Mono></a> : null}
        </span>
      ))}
    </span>
  )

  // ── actions ───────────────────────────────────────────────────────────────
  const createWallets = () => run("create", async () => {
    const n = Math.max(1, Math.min(100, Math.floor(Number(newCount)) || 1))
    const r = await post<{ dir: string; wallets: Array<Wallet & { path: string }>; mainWallet: string | null }>("/api/wallets", { count: n })
    toast({ tone: "ok", title: `${r.wallets.length} new wallet${r.wallets.length === 1 ? "" : "s"}: ${r.wallets.map((w) => w.label).join(", ")}${r.wallets.some((w) => w.publicKey === r.mainWallet) ? " (★)" : ""}`, detail: <>Keys saved to <span className="font-mono text-xs break-all">{r.dir}</span></> })
    await changed()
  })
  const importWallet = () => run("import", async () => {
    const r = await post<{ dir: string; wallet: Wallet & { path: string; existed: boolean }; mainWallet: string | null }>("/api/wallets/import", { privateKey: importKey.trim() })
    setImportKey(""); setImportOpen(false)
    toast({ tone: "ok", title: r.wallet.existed ? `${r.wallet.label} was already in the folder` : `Imported ${r.wallet.label}${r.wallet.publicKey === r.mainWallet ? " (★)" : ""}`, detail: <span className="font-mono text-xs break-all">{r.wallet.path}</span> })
    await changed()
  })
  const star = (pk: string) => run(`star:${pk}`, async () => { await post("/api/wallets/main", { publicKey: pk }); await changed() })
  const saveEdit = () => run("rename", async () => {
    if (!editing) return
    await post("/api/wallets/update", { publicKey: editing.publicKey, label: editing.label, role: editing.role })
    setEditing(null)
    await changed()
  })
  const fund = (publicKeys: string[], amount: string) => run("fund", async () => {
    const a = Number(amount)
    if (!(a > 0)) throw { error: `Enter the ${chain.symbol} amount each wallet gets` }
    const r = await post<{ results: Sent[] }>("/api/wallets/fund", { publicKeys, amount: a })
    setFunding(null)
    const failed = r.results.filter((x) => x.error).length
    toast({ tone: failed ? "error" : "ok", sticky: failed > 0, title: `Fund from ★: ${r.results.length - failed}/${r.results.length} sent · ${a} ${chain.symbol} each`, detail: sentLines(r.results, () => <span>+{a} {chain.symbol}</span>) })
    await load()
  })
  const fundViaExchange = () => run("exchange", async () => {
    const a = Number(each)
    if (!(a > 0)) throw { error: `Enter the ${chain.symbol} amount each wallet gets` }
    const r = await post<{ batchId?: string; legs: Leg[] }>("/api/wallets/fund-exchange", { publicKeys: picked, amount: a, mode, venue })
    setLegs(r.legs)
    const failed = r.legs.filter((l) => l.error).length
    toast({ tone: failed ? "error" : "ok", sticky: failed > 0, title: `Fund via exchange: ${r.legs.length - failed}/${r.legs.length} order${r.legs.length === 1 ? "" : "s"} opened · ${mode} · ${a} ${chain.symbol} each`, detail: failed ? r.legs.filter((l) => l.error).map((l) => `${chain.short(l.publicKey)}: ${l.error}${l.code ? ` · ${l.code}` : ""}`).join("; ") : "Each wallet is paid by an exchange hot wallet, not by ★. Legs below update until they complete." })
    await load()
  })
  const gather = () => run("gather", async () => {
    const r = await post<{ to: string; results: Sent[] }>("/api/wallets/gather", { publicKeys: picked })
    const got = r.results.reduce((s, x) => s + (x.recovered ?? x.eth ?? 0), 0)
    const failed = r.results.filter((x) => x.error).length
    toast({ tone: failed ? "error" : "ok", sticky: failed > 0, title: `Gather to ★: ${chain.fmt(got)} ${chain.symbol} from ${r.results.length} wallet${r.results.length === 1 ? "" : "s"}`, detail: sentLines(r.results, (x) => <span>{chain.fmt(x.recovered ?? x.eth)} {chain.symbol}</span>) })
    await load()
  })
  const closeAccounts = () => run("close", async () => {
    const r = await post<{ totalClosed: number; results: Array<{ publicKey: string; closed: number; error?: string }> }>("/api/wallets/close-accounts", { publicKeys: picked })
    const failed = r.results.filter((x) => x.error)
    toast({ tone: failed.length ? "error" : "ok", sticky: failed.length > 0, title: `Closed ${r.totalClosed} empty token account${r.totalClosed === 1 ? "" : "s"}; rent went to ★`, detail: failed.length ? failed.map((x) => `${chain.short(x.publicKey)}: ${x.error}`).join("; ") : undefined })
    await load()
  })
  const showKey = (pk: string) => run(`key:${pk}`, async () => {
    if (shownKey?.publicKey === pk) { setShownKey(null); return }
    if (!window.confirm(`Show the ${chain.keyNoun} of this wallet on screen?\n\nAnyone who sees it controls the wallet.`)) return
    const r = await post<{ wallets: Array<{ publicKey: string; privateKey: string }> }>("/api/wallets/export", { publicKeys: [pk] })
    setShownKey({ publicKey: pk, privateKey: r.wallets[0].privateKey })
  })
  const exportKeys = () => run("export", async () => {
    if (!window.confirm(`Download the ${chain.keyNoun}s of ${picked.length} wallet${picked.length === 1 ? "" : "s"} as a JSON file?\n\nAnyone with the file controls the wallets.`)) return
    const r = await post<{ wallets: Array<{ publicKey: string; privateKey: string; label: string }> }>("/api/wallets/export", { publicKeys: picked })
    downloadText(`wallet-keys-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`, JSON.stringify(r.wallets.map((w) => ({ label: w.label, publicKey: w.publicKey, privateKey: w.privateKey, chain: chain.name })), null, 2))
    toast({ tone: "ok", title: `Exported ${r.wallets.length} key${r.wallets.length === 1 ? "" : "s"}`, detail: "The download holds the private keys. The files in the folder are untouched." })
  })
  const archive = () => run("archive", async () => {
    const holding = picked.filter((pk) => (row(pk)?.native ?? 0) > 0)
    const msg = `Archive ${picked.length} wallet${picked.length === 1 ? "" : "s"}?\n\nTheir key files move to the folder's archived/ subfolder and leave this list. Nothing is deleted.` + (holding.length ? `\n\n${holding.length} of them still hold ${chain.symbol}: gather first if you want it back on ★.` : "")
    if (!window.confirm(msg)) return
    const r = await post<{ archived: string[]; dir: string }>("/api/wallets/archive", { publicKeys: picked })
    setSelected(new Set())
    toast({ tone: "ok", title: `Archived ${r.archived.length} wallet${r.archived.length === 1 ? "" : "s"}`, detail: <>Keys kept in <span className="font-mono text-xs break-all">{r.dir}</span></> })
    await changed()
  })
  const rewrite = () => run("rewrite", async () => {
    const r = await post<{ dir: string; files: number; restored: string[]; csvAdded: number }>("/api/wallets/rewrite-backups")
    toast({ tone: "ok", title: `Backups rewritten: ${r.files} wallet file${r.files === 1 ? "" : "s"}`, detail: `${r.restored.length} restored from wallets.csv · ${r.csvAdded} CSV line${r.csvAdded === 1 ? "" : "s"} added · ${r.dir}` })
    await changed()
  })
  const clearCoin = () => { writeChosenCoin(null); setCoin(null); void load() }

  const venueList = venues ? Object.entries(venues.venues) : []
  const noMain = !main

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Wallets <span className="text-muted-foreground text-base font-normal">{wallets.length}{folder?.archived ? <span className="text-sm"> · {folder.archived} archived</span> : null}</span></h1>
        <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-xs">
          <span>Keys are saved to <span className="font-mono break-all">{folder?.dir ?? "…"}</span></span>
          <span>·</span>
          <button type="button" className="hover:text-foreground underline underline-offset-4" onClick={rewrite} disabled={!!busy}>{busy === "rewrite" ? "Rewriting…" : "Rewrite backups"}</button>
        </p>
      </div>

      <FailureBox failure={failure} />
      {folder && folder.missing.length > 0 ? (
        <div className="border-destructive/40 bg-destructive/5 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm">
          <span className="text-destructive font-medium">{folder.missing.length} wallet{folder.missing.length === 1 ? "" : "s"} in wallets.csv have no file:</span>
          {folder.missing.map((m) => <Mono key={m.publicKey} className="text-xs">{m.label || chain.short(m.publicKey)}</Mono>)}
          <Button size="xs" variant="outline" className="ml-auto" onClick={rewrite} disabled={!!busy}>Rewrite backups</Button>
        </div>
      ) : null}

      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={createWallets} disabled={!!busy}>{busy === "create" ? "Writing files…" : "+ New wallet"}</Button>
        <span className="inline-flex items-center gap-1 text-sm">
          <span className="text-muted-foreground">×</span>
          <Input inputMode="numeric" value={newCount} onChange={(e) => setNewCount(e.target.value)} className="h-9 w-14 text-center font-mono" aria-label="How many wallets to create" />
        </span>
        <Button variant="outline" onClick={() => setImportOpen((v) => !v)} disabled={!!busy}>Import {importOpen ? "▴" : "▾"}</Button>
        <Button variant="outline" size="icon-sm" aria-label="Refresh" title="Refresh the list and balances" onClick={() => void load()} disabled={!!busy}><RefreshCw /></Button>
        <Input placeholder="search label or address…" value={search} onChange={(e) => setSearch(e.target.value)} className="ml-auto w-full sm:w-64" />
        {coin ? (
          <Pill title={`Coin chosen on the Trading page (${coin.coin}): its balance per wallet is the ${coin.symbol ?? "Tokens"} column`}>
            {coin.symbol ?? chain.short(coin.coin)}
            <button type="button" aria-label="Forget the chosen coin" onClick={clearCoin} className="hover:text-foreground"><X className="size-3" /></button>
          </Pill>
        ) : null}
      </div>
      {importOpen ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border p-3">
          <Input type="password" autoComplete="off" placeholder={chain.keyNoun} value={importKey} onChange={(e) => setImportKey(e.target.value)} className="min-w-0 flex-1 font-mono text-xs" onKeyDown={(e) => { if (e.key === "Enter" && importKey.trim()) importWallet() }} />
          <Button onClick={importWallet} disabled={!!busy || !importKey.trim()}>{busy === "import" ? "Writing file…" : "Import"}</Button>
          <Button variant="ghost" onClick={() => { setImportOpen(false); setImportKey("") }} disabled={busy === "import"}>Cancel</Button>
          <p className="text-muted-foreground w-full text-xs">The key is written to the folder before the wallet shows up. The first wallet ever added becomes ★.</p>
        </div>
      ) : null}

      {/* the list */}
      <Table>
        <THead>
          <TR>
            <TH className="w-8"><Checkbox checked={shown.length > 0 && shown.every((w) => selected.has(w.publicKey))} onChange={(e) => setSelected(e.target.checked ? new Set([...selected, ...shown.map((w) => w.publicKey)]) : new Set([...selected].filter((pk) => !shown.some((w) => w.publicKey === pk))))} aria-label="Select all shown" /></TH>
            <TH className="w-8" title="★ = the main wallet: pays for everything, receives gathers, is the default creator">★</TH>
            <TH>Label</TH>
            <TH>Address</TH>
            <TH className="text-right">{chain.symbol}</TH>
            {coin ? <TH className="text-right">{coin.symbol ?? "Tokens"}</TH> : null}
            <TH className="w-px" />
          </TR>
        </THead>
        <TBody>
          {folder && wallets.length === 0 ? <TR><TD colSpan={7} className="text-muted-foreground py-8 text-center">No wallets yet. Press <b>+ New wallet</b> (it becomes ★) or <b>Import</b> a key.</TD></TR> : null}
          {folder && wallets.length > 0 && shown.length === 0 ? <TR><TD colSpan={7} className="text-muted-foreground py-6 text-center">Nothing matches “{search}”.</TD></TR> : null}
          {shown.map((w) => {
            const isMain = w.publicKey === main
            const b = row(w.publicKey)
            const open = editing?.publicKey === w.publicKey || funding?.publicKey === w.publicKey || shownKey?.publicKey === w.publicKey
            return (
              <React.Fragment key={w.publicKey}>
                <TR data-selected={selected.has(w.publicKey)} className={isMain ? "font-medium" : ""}>
                  <TD><Checkbox checked={selected.has(w.publicKey)} onChange={() => toggle(w.publicKey)} aria-label={`Select ${w.label}`} /></TD>
                  <TD>
                    <button type="button" title={isMain ? "The main wallet" : "Make this the main wallet (★)"} className={`text-base leading-none ${isMain ? "" : "text-muted-foreground hover:text-foreground"}`} onClick={() => !isMain && star(w.publicKey)} disabled={!!busy || isMain}>{isMain ? "★" : "☆"}</button>
                  </TD>
                  <TD>
                    <button type="button" className="hover:underline underline-offset-4" title="Rename" onClick={() => { setFunding(null); setShownKey(null); setEditing(editing?.publicKey === w.publicKey ? null : { publicKey: w.publicKey, label: w.label, role: w.role }) }}>{w.label}</button>
                    {w.role !== "trader" && w.role !== "funding" ? <Pill className="ml-2 h-5">{w.role}</Pill> : null}
                  </TD>
                  <TD>
                    <span className="inline-flex items-center gap-1">
                      <Mono>{chain.short(w.publicKey)}</Mono>
                      <Button variant="ghost" size="icon-xs" aria-label="Copy address" title="Copy address" onClick={() => { void copyText(w.publicKey); toast({ tone: "muted", title: "Address copied", detail: <Mono className="text-xs break-all">{w.publicKey}</Mono> }) }}><Copy /></Button>
                      <a className="text-muted-foreground hover:text-foreground" href={chain.explorerAddress(w.publicKey)} target="_blank" rel="noreferrer" aria-label="Open in explorer"><ExternalLink className="size-3" /></a>
                    </span>
                  </TD>
                  <TD className="text-right font-mono text-xs">{chain.fmt(b?.native)}</TD>
                  {coin ? <TD className="text-right font-mono text-xs">{b?.tokens === undefined ? "–" : b.tokens.toLocaleString("en-US", { maximumFractionDigits: 2 })}</TD> : null}
                  <TD>
                    <span className="inline-flex gap-1">
                      <Button size="xs" variant="outline" onClick={() => { setEditing(null); setShownKey(null); setFunding(funding?.publicKey === w.publicKey ? null : { publicKey: w.publicKey, amount: each }) }} disabled={!!busy || isMain} title={isMain ? "★ is the wallet that funds the others" : `Send ${chain.symbol} from ★ to this wallet`}>Fund</Button>
                      <Button size="xs" variant="outline" onClick={() => { setEditing(null); setFunding(null); void showKey(w.publicKey) }} disabled={!!busy} title={`Show the ${chain.keyNoun}`}>Key</Button>
                    </span>
                  </TD>
                </TR>
                {open ? (
                  <TR className="bg-muted/30">
                    <TD colSpan={coin ? 7 : 6} className="py-2">
                      {editing?.publicKey === w.publicKey ? (
                        <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); saveEdit() }}>
                          <Input autoFocus value={editing.label} onChange={(e) => setEditing({ ...editing, label: e.target.value })} className="h-8 w-56" aria-label="Label" />
                          <Select value={editing.role} onChange={(e) => setEditing({ ...editing, role: e.target.value })} className="h-8 w-32 text-xs" aria-label="Role tag" title="An optional tag for launches; it changes nothing else">
                            {[...ROLE_TAGS, ...(editing.role === "funding" ? ["funding"] : [])].map((r) => <option key={r} value={r}>{r === "trader" ? "no tag" : r}</option>)}
                          </Select>
                          <Button size="sm" type="submit" disabled={!!busy || !editing.label.trim()}><Check />Save</Button>
                          <Button size="sm" variant="ghost" type="button" onClick={() => setEditing(null)}>Cancel</Button>
                        </form>
                      ) : null}
                      {funding?.publicKey === w.publicKey ? (
                        <form className="flex flex-wrap items-center gap-2 text-sm" onSubmit={(e) => { e.preventDefault(); void fund([w.publicKey], funding.amount) }}>
                          <span className="text-muted-foreground">Send</span>
                          <Input autoFocus inputMode="decimal" value={funding.amount} onChange={(e) => setFunding({ ...funding, amount: e.target.value })} className="h-8 w-28 font-mono" aria-label="Amount" />
                          <span className="text-muted-foreground">{chain.symbol} from ★ to {w.label}</span>
                          <Button size="sm" type="submit" disabled={!!busy || noMain}>{busy === "fund" ? "Sending…" : "Send from ★"}</Button>
                          <Button size="sm" variant="ghost" type="button" onClick={() => setFunding(null)}>Cancel</Button>
                        </form>
                      ) : null}
                      {shownKey?.publicKey === w.publicKey ? (
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                          <Mono className="bg-background rounded border px-2 py-1 text-xs break-all select-all">{shownKey.privateKey}</Mono>
                          <Button size="xs" variant="outline" onClick={() => { void copyText(shownKey.privateKey); toast({ tone: "muted", title: "Key copied to the clipboard" }) }}><Copy />Copy</Button>
                          <Button size="xs" variant="ghost" onClick={() => setShownKey(null)}>Hide</Button>
                        </div>
                      ) : null}
                    </TD>
                  </TR>
                ) : null}
              </React.Fragment>
            )
          })}
        </TBody>
      </Table>

      {/* exchange legs */}
      {legs.length > 0 ? (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-xs"><span className="text-muted-foreground">Exchange legs (update every 5 s)</span><button type="button" className="text-muted-foreground hover:text-foreground underline-offset-4 hover:underline" onClick={() => setLegs([])}>clear</button></div>
          <Table>
            <THead><TR><TH>Wallet</TH><TH>Status</TH><TH>Venue</TH><TH>Deposit</TH><TH>Receipt</TH></TR></THead>
            <TBody>
              {legs.map((l) => {
                const dep = l.signature ?? l.depositHash
                return (
                  <TR key={l.publicKey}>
                    <TD><Mono>{chain.short(l.publicKey)}</Mono></TD>
                    <TD><Pill tone={l.status === "completed" ? "ok" : l.error ? "error" : "muted"}>{l.status ?? "–"}</Pill>{l.error ? <span className="text-destructive ml-2 text-xs">{l.error}{l.code ? ` · ${l.code}` : ""}</span> : null}</TD>
                    <TD>{l.venue ?? "–"}</TD>
                    <TD>{dep ? <a className="underline underline-offset-4" href={chain.explorerTx(dep)} target="_blank" rel="noreferrer"><Mono className="text-xs">{chain.short(dep)}</Mono></a> : "–"}</TD>
                    <TD>{l.receipt ? <a className="underline underline-offset-4" href={l.receipt} target="_blank" rel="noreferrer">receipt</a> : "–"}</TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>
        </div>
      ) : null}

      {/* selection bar */}
      {picked.length > 0 ? (
        <div className="bg-background/95 sticky bottom-3 z-30 flex flex-col gap-2 rounded-xl border p-3 shadow-lg backdrop-blur">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{picked.length} selected</span>
            <button type="button" className="text-muted-foreground hover:text-foreground text-xs underline-offset-4 hover:underline" onClick={() => setSelected(new Set())}>clear</button>
            <span className="text-muted-foreground mx-1">·</span>
            <span className="text-muted-foreground">Amount each</span>
            <Input inputMode="decimal" value={each} onChange={(e) => setEach(e.target.value)} className="h-8 w-24 font-mono" aria-label="Amount each" />
            <Button size="sm" onClick={() => void fund(picked.filter((pk) => pk !== main), each)} disabled={!!busy || noMain || picked.every((pk) => pk === main)} title={noMain ? "No ★ wallet yet" : `${each} ${chain.symbol} from ★ to each selected wallet`}>{busy === "fund" ? "Sending…" : "Fund from ★"}</Button>
            <Button size="sm" variant="secondary" onClick={() => setExchangeOpen((v) => !v)} disabled={!!busy || noMain || venues?.exchange === "off"} title={venues?.exchange === "off" ? "Exchange routing is switched off on the API right now" : "Each wallet is paid by an exchange hot wallet instead of by ★: less on-chain linkability"}>Fund via exchange {exchangeOpen ? "▴" : "▾"}</Button>
            <Button size="sm" variant="outline" onClick={gather} disabled={!!busy || noMain} title={`Sweep every selected wallet's ${chain.symbol} (minus the fee) back to ★`}>{busy === "gather" ? "Sweeping…" : "Gather to ★"}</Button>
            {chain.features.tokenAccounts ? <Button size="sm" variant="outline" onClick={closeAccounts} disabled={!!busy || noMain} title="Close every empty token account of the selected wallets; the rent goes to ★">{busy === "close" ? "Closing…" : "Close empty token accounts"}</Button> : null}
            <Button size="sm" variant="outline" onClick={exportKeys} disabled={!!busy}>{busy === "export" ? "Reading…" : "Export keys"}</Button>
            <Button size="sm" variant="outline" onClick={archive} disabled={!!busy || picked.includes(main ?? "")} title={picked.includes(main ?? "") ? "★ cannot be archived; star another wallet first" : "Move the key files to archived/ and drop the wallets from this list"}>{busy === "archive" ? "Archiving…" : "Archive"}</Button>
          </div>
          {exchangeOpen ? (
            <div className="flex flex-wrap items-center gap-2 border-t pt-2 text-sm">
              <span className="text-muted-foreground">Mode</span>
              <Select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)} className="h-8 w-28 text-xs"><option value="float">float</option><option value="fixed">fixed</option><option value="private">private</option></Select>
              <span className="text-muted-foreground">Venue</span>
              <Select value={venue} onChange={(e) => setVenue(e.target.value)} className="h-8 w-48 text-xs">
                <option value="auto">auto</option>
                <option value="random">random</option>
                {venueList.map(([name, v]) => <option key={name} value={name} disabled={v.status !== "open"}>{name}{v.default ? " (default)" : ""}{v.status !== "open" ? ` · ${v.reason ?? v.status}` : ""}</option>)}
              </Select>
              <Button size="sm" onClick={fundViaExchange} disabled={!!busy || picked.length > 25}>{busy === "exchange" ? "Opening orders…" : `Send ${each} ${chain.symbol} to ${picked.length} via exchange`}</Button>
              {picked.length > 25 ? <span className="text-destructive text-xs">at most 25 wallets per exchange batch</span> : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
