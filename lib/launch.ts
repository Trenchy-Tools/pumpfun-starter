/**
 * A pump.fun launch, start to finish, on the TrenchyTools API. Read top to bottom:
 *
 *   0. plan         the funding plan (fundingPlan): what every wallet needs. On a custom pair (the coin priced in USDC,
 *                   a stock, another coin) it reads each wallet's quote-asset balance and refuses when one is short;
 *                   options pump.fun would refuse (Mayhem on a stock pair, a creator fee on a SOL coin) are refused
 *                   here with the API's own error.
 *   1. wallets      the ★ wallet is the creator (dev) unless the form names another; the buyers are explicit lists
 *                   `{ publicKey, amount }[]` per group (bundle / snipers / holders) picked on the Launch page. The old
 *                   `count × solEach` shape still works: wallets are then picked by role, missing ones created
 *                   (written to disk first). Every key must have its file.
 *   2. mint         a vanity key from the pool, or Keypair.generate() (saved to the pool as used).
 *   3. funding      optional: SOL from the funding wallet to each buyer per the funding plan (plain transfers). The
 *                   quote asset of a custom pair is never moved by this app: the plan says what to send where.
 *   4. lookup table 5–16 bundle buyers: POST /api/sol/lut, sign + send each transaction, wait until `ready`.
 *   5. bundle       POST /api/sol/trade-local with an ARRAY [create(+dev buy, tip), buys…] → sign each →
 *                   POST /api/sol/simulate on the create → POST /api/sol/bundle → GET /api/sol/bundle/:id and
 *                   GET /api/sol/tx/:sig. If Jito refuses or the bundle does not land: create via POST /api/sol/send,
 *                   then each buy one by one.
 *   6. snipers      the moment the create is confirmed: trade-local buy → sign → send, one every `gapMs`.
 *   7. holders      after `delayS`, buys spread over `windowS` with jitter.
 *   8. record       launches.json in _app/pumpfun-starter/ (mint, wallets by role, signatures), and the table's rent
 *                   comes back (deactivate now, close ~4 min later).
 *
 * Every stage is emitted to the launch log (server-sent events from GET /api/launch/:id/events).
 */
import { Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js"
import { LAUNCHES_FILE, readJson, serverState, writeJson } from "./paths"
import { effectiveSettings } from "./settings"
import { ApiError, isSolQuote, SOL_PAIR, SOL_QUOTE, trenchy, type BuiltTx, type Expected, type Pair, type Quote, type Simulation, type TradeBody, type Trenchy } from "./trenchy"
import * as vanity from "./vanity"
import { assertBackedUp, createWallets, getWallet, keypairOf, listWallets, mainWallet, NotBackedUpError, type Role, type WalletInfo } from "./wallets"

/** A Jito bundle holds 5 transactions: the create plus 4. With a lookup table each of the 4 carries 4 buyers. */
export const PLAIN_BUNDLE_WALLETS = 4
export const BUYERS_PER_TX = 4
export const MAX_BUNDLE_WALLETS = PLAIN_BUNDLE_WALLETS * BUYERS_PER_TX
/** The API fee on the SOL side of every buy (0.5 %), so a wallet funded for a buy can also pay it. */
const API_FEE = 0.005
const GAS_RESERVE = 0.01
const LUT_RENT_RESERVE = 0.02
const PRIORITY_FEE_SOL = 0.0005
/**
 * On a custom pair the buy is paid in the quote asset but our fee is still SOL: 0.5 % of the buy's SOL value at a
 * market price, floored at 0.0001 SOL. The plan cannot price the asset, so it keeps a flat reserve per wallet that
 * covers buys up to ~0.4 SOL of value; bigger buys need more SOL in the wallet.
 */
const CUSTOM_PAIR_FEE_RESERVE = 0.002

/** One picked buyer: a wallet of the folder and its buy, in the coin's quote asset. */
export type Buyer = { publicKey: string; amount: number }
export type BuyerGroup = { count: number; solEach: number; wallets?: Buyer[] }
/** A buyer with its wallet record. */
export type Picked = WalletInfo & { amount: number }

export type LaunchForm = {
  name: string
  symbol: string
  description: string
  /** from POST /api/ipfs (the Launch page uploads the image first) */
  metadataUri: string
  twitter: string
  telegram: string
  website: string
  mint: { mode: "vanity" | "random"; publicKey?: string }
  /**
   * What the coin is priced and traded in: "" / "SOL", or a symbol / mint from GET /api/sol/pairs (USDC, SPYx, …) or a
   * pump coin's mint. Every amount below (devBuySol, solEach) is in THIS asset; the field names keep "Sol" for history.
   */
  quoteMint: string
  /** pump.fun's agent trades the coin for 24 h (2 B supply, no synthetic migration). SOL / USDC quotes only. */
  mayhemMode: boolean
  /** your creator fee in basis points on a custom pair (0 = pump.fun's schedule; SOL and USDC coins must leave it 0) */
  creatorFeeBps: number
  /** the creator fee goes to the holders, permanently */
  holderReward: boolean
  /** the creator: the ★ wallet when empty */
  devWallet?: string
  devBuySol: number
  /**
   * Each buyer group: an explicit list of wallets with their own amounts (the Launch page's "Pick buyers"), or the old
   * `count × solEach` (wallets picked by role, missing ones created). `wallets` wins when it has entries.
   */
  bundle: BuyerGroup
  snipers: BuyerGroup & { gapMs: number }
  holders: BuyerGroup & { delayS: number; windowS: number }
  /** send SOL from the ★ wallet to every buyer first (per the funding plan) */
  fundFirst: boolean
  /** false = no Jito bundle at all: create, then buys one by one */
  useJito: boolean
  slippage: number
}

export type LaunchRecord = {
  id: string
  name: string
  symbol: string
  mint: string | null
  status: "running" | "confirmed" | "error"
  createdAt: string
  wallets: { dev: string; bundle: string[]; sniper: string[]; holder: string[] }
  signatures: { create?: string; bundleId?: string; snipers: string[]; holders: string[] }
  lookupTable?: string
  /** the pair the coin trades in (absent on records from before custom pairs = SOL) and the create options */
  quote?: Quote
  mayhem?: boolean
  holderReward?: boolean
  creatorFeeBps?: number
  error?: string
}

export type LaunchEvent = { at: number; stage: string; message: string; signature?: string; mint?: string; link?: string }

// ── records + event log ─────────────────────────────────────────────────────

export const readLaunches = (): LaunchRecord[] => readJson<LaunchRecord[]>(LAUNCHES_FILE, [])
function saveLaunch(rec: LaunchRecord): void {
  const all = readLaunches().filter((l) => l.id !== rec.id)
  writeJson(LAUNCHES_FILE, [...all, rec])
}

const log = serverState("launchLog", () => ({ events: new Map<string, LaunchEvent[]>(), listeners: new Map<string, Set<(e: LaunchEvent) => void>>() }))

export const eventsOf = (id: string): LaunchEvent[] => log.events.get(id) ?? []
export function subscribe(id: string, cb: (e: LaunchEvent) => void): () => void {
  if (!log.listeners.has(id)) log.listeners.set(id, new Set())
  log.listeners.get(id)!.add(cb)
  return () => log.listeners.get(id)?.delete(cb)
}
function emitter(id: string) {
  return (stage: string, message: string, extra: Partial<LaunchEvent> = {}) => {
    const e: LaunchEvent = { at: Date.now(), stage, message, ...extra }
    if (!log.events.has(id)) log.events.set(id, [])
    log.events.get(id)!.push(e)
    for (const cb of log.listeners.get(id) ?? []) cb(e)
    console.log(`[launch ${id.slice(0, 6)}] ${stage}: ${message}`)
  }
}
type Emit = ReturnType<typeof emitter>

// ── funding plan ────────────────────────────────────────────────────────────

export type PlanRow = {
  role: Role | "dev"; label: string; publicKey: string | null
  /** the buy, in the coin's quote asset (SOL unless the form picks a pair) */
  buy: number
  /** SOL the wallet needs: on a SOL coin buy + 0.5 % fee + 0.01 reserve; on a custom pair the 0.01 reserve + the API-fee reserve. The dev adds the tip and the table rent. */
  needSol: number
  /** custom pair only: quote asset the wallet needs (buy + slippage), what it holds, and what is missing */
  needQuote?: number; haveQuote?: number; sendQuote?: number; quoteAccount?: string | null
}
export type Shortfall = { role: string; label: string; publicKey: string | null; send: number; symbol: string; account: string | null }
export type Refusal = { error: string; code?: string; hint?: string; docs?: string; status: number; [k: string]: unknown }
export type Plan = {
  rows: PlanRow[]
  /** SOL the funding wallet pays out in total (every row's needSol) */
  total: number
  tipSol: number; useLut: boolean
  /** the coin's quote asset; `custom` when it is not SOL */
  quote: Quote; custom: boolean
  mayhem: boolean; holderReward: boolean; creatorFeeBps: number
  /** custom pair: quote asset the whole launch needs, and the wallets that must still receive some ("send X SYMBOL to …") */
  totalQuote: number
  shortfalls: Shortfall[]
  /** the API refused the options (mayhem_quote_not_allowed, creator_fee_not_allowed, holder_reward_disabled, …): its error, verbatim */
  refusal: Refusal | null
  /** launchable: no refusal and no wallet short of the quote asset */
  ok: boolean
}

/** Sums of lamport-sized numbers without float dust (9 decimals). */
const sum = (xs: number[]) => Math.round(xs.reduce((s, x) => s + x, 0) * 1e9) / 1e9

/** Codes the plan reports as a refusal. Anything else (a short balance, a node hiccup) is left to Simulate / Launch. */
const REFUSALS = new Set(["mayhem_quote_not_allowed", "mayhem_disabled", "creator_fee_not_allowed", "holder_reward_disabled", "unsupported_quote", "quote_not_eligible", "launch_disabled"])

/** The create body the launch sends, from the form: quote, Mayhem, holder rewards and creator fee only when set. */
function createBody(form: LaunchForm, creator: string, mint: string, pair: Pair, priorityFee: number, uri = form.metadataUri): TradeBody {
  const custom = !isSolQuote(pair)
  return {
    publicKey: creator, action: "create", mint, tokenMetadata: { name: form.name, symbol: form.symbol, uri },
    amount: form.devBuySol, ...(custom ? { denominatedInQuote: "true" as const } : { denominatedInSol: "true" as const }), slippage: form.slippage, priorityFee, pool: "pump",
    ...(custom ? { quoteMint: pair.mint } : {}),
    ...(form.mayhemMode ? { mayhemMode: true } : {}),
    ...(form.holderReward ? { holderReward: true } : {}),
    ...(custom && form.creatorFeeBps > 0 ? { creatorFeeBps: Math.round(form.creatorFeeBps) } : {}),
  }
}

/** The explicit buyers of a group, or null when the form uses the old count × solEach shape. */
const explicit = (g: BuyerGroup): Buyer[] | null => (g.wallets && g.wallets.length ? g.wallets : null)
/** How many buyers a group has, whichever shape it uses. */
export const groupSize = (g: BuyerGroup): number => explicit(g)?.length ?? g.count
/** The creator: the form's dev wallet (must be in the folder) or the ★ wallet. */
export function devWallet(form: LaunchForm): WalletInfo | null {
  if (form.devWallet) return getWallet(form.devWallet)
  return mainWallet()
}

/** The SOL rows: unchanged for a SOL coin (buy + 0.5 % fee + 0.01 reserve; dev + tip + table rent). Explicit buyers keep their own amounts. */
function solRows(form: LaunchForm, custom: boolean): { rows: PlanRow[]; tipSol: number; useLut: boolean } {
  const tipSol = effectiveSettings().jitoTipLamports / LAMPORTS_PER_SOL
  const useLut = form.useJito && groupSize(form.bundle) > PLAIN_BUNDLE_WALLETS
  const need = (buy: number) => (custom ? GAS_RESERVE + (buy > 0 ? CUSTOM_PAIR_FEE_RESERVE : 0) : buy * (1 + API_FEE) + GAS_RESERVE)
  const dev = devWallet(form)
  const rows: PlanRow[] = [{ role: "dev", label: dev?.label ?? (form.devWallet ? `${form.devWallet.slice(0, 6)}… (not in folder)` : "★ wallet"), publicKey: dev?.publicKey ?? form.devWallet ?? null, buy: form.devBuySol, needSol: need(form.devBuySol) + (form.useJito ? tipSol : 0) + (useLut ? LUT_RENT_RESERVE : 0) }]
  const group = (role: Exclude<Role, "funding" | "trader">, g: BuyerGroup) => {
    const picked = explicit(g)
    if (picked) {
      for (const b of picked) {
        const w = getWallet(b.publicKey)
        rows.push({ role, label: w?.label ?? `${b.publicKey.slice(0, 6)}… (not in folder)`, publicKey: b.publicKey, buy: b.amount, needSol: need(b.amount) })
      }
      return
    }
    const have = listWallets(role)
    for (let i = 0; i < g.count; i++) rows.push({ role, label: have[i]?.label ?? `${role} ${i + 1} (new)`, publicKey: have[i]?.publicKey ?? null, buy: g.solEach, needSol: need(g.solEach) })
  }
  group("bundle", form.bundle)
  group("sniper", form.snipers)
  group("holder", form.holders)
  return { rows, tipSol, useLut }
}

/**
 * What every wallet needs before the launch.
 *   SOL coin: buy + 0.5 % API fee + 0.01 SOL reserve; the dev (funding wallet) also pays the Jito tip and, with 5+
 *             bundle buyers, the lookup table's rent (refunded on close). No API call.
 *   Custom pair (USDC / a stock / a coin): the buy is in the quote asset, so each wallet's balance of it is read
 *             (GET /api/sol/balances?wallets=…&mint=<quote>) and compared with buy + slippage; SOL is still needed for
 *             network fees and our fee (0.01 + a small reserve). Wallets short of the quote asset go to `shortfalls`
 *             ("send X SYMBOL to …") and the plan is not ok. This app never moves the quote asset itself.
 *   Options:  Mayhem, holder rewards or a creator fee are checked by building the create once against the API with a
 *             throwaway mint (nothing is sent): a 422 like `mayhem_quote_not_allowed` comes back verbatim as `refusal`.
 */
export async function fundingPlan(form: LaunchForm): Promise<Plan> {
  const api = trenchy()
  const wantsOptions = form.mayhemMode || form.holderReward || form.creatorFeeBps > 0
  const plain = !form.quoteMint.trim() || form.quoteMint.trim().toUpperCase() === "SOL"
  if (plain && !wantsOptions) {
    const { rows, tipSol, useLut } = solRows(form, false)
    return { rows, total: sum(rows.map((r) => r.needSol)), tipSol, useLut, quote: SOL_QUOTE, custom: false, mayhem: false, holderReward: false, creatorFeeBps: 0, totalQuote: 0, shortfalls: [], refusal: null, ok: true }
  }

  let pair: Pair
  let refusal: Refusal | null = null
  try {
    pair = await api.resolvePair(form.quoteMint)
  } catch (e) {
    if (!(e instanceof ApiError)) throw e
    refusal = e.toJSON()
    pair = SOL_PAIR
  }
  const quote: Quote = { mint: pair.mint, symbol: pair.symbol, decimals: pair.decimals, kind: pair.kind }
  const custom = !isSolQuote(quote)
  const { rows, tipSol, useLut } = solRows(form, custom)
  const base = { rows, tipSol, useLut, quote, custom, mayhem: form.mayhemMode, holderReward: form.holderReward, creatorFeeBps: custom ? Math.round(form.creatorFeeBps) : 0 }

  // the options, judged by the API itself (a build with a throwaway mint; the dev's quote balance is checked below)
  const dev = devWallet(form)
  if (!refusal && wantsOptions && dev) {
    try {
      await api.tradeLocal(createBody({ ...form, name: form.name || "Plan", symbol: form.symbol || "PLAN" }, dev.publicKey, Keypair.generate().publicKey.toBase58(), pair, PRIORITY_FEE_SOL, form.metadataUri || "https://trenchytools.lol/simulate.json"))
    } catch (e) {
      if (e instanceof ApiError && e.code && REFUSALS.has(e.code)) refusal = e.toJSON()
      else if (!(e instanceof ApiError)) throw e
    }
  }

  if (!custom) {
    return { ...base, total: sum(rows.map((r) => r.needSol)), totalQuote: 0, shortfalls: [], refusal, ok: !refusal }
  }

  // custom pair: the quote asset each wallet holds vs buy + slippage
  const slip = 1 + Math.max(1, form.slippage) / 100
  const known = rows.map((r) => r.publicKey).filter((k): k is string => !!k)
  const balances = new Map((known.length ? await api.balances(known, quote.mint) : []).map((b) => [b.wallet, b.token]))
  const round = (n: number) => Math.ceil(n * 10 ** Math.min(quote.decimals, 9)) / 10 ** Math.min(quote.decimals, 9)
  const shortfalls: Shortfall[] = []
  for (const r of rows) {
    r.needQuote = round(r.buy * slip)
    const t = r.publicKey ? balances.get(r.publicKey) : undefined
    r.haveQuote = t?.balance ?? 0
    r.quoteAccount = t?.account ?? null
    r.sendQuote = Math.max(0, round(r.needQuote - r.haveQuote))
    if (r.sendQuote > 0) shortfalls.push({ role: r.role, label: r.label, publicKey: r.publicKey, send: r.sendQuote, symbol: quote.symbol, account: r.quoteAccount })
  }
  return { ...base, total: sum(rows.map((r) => r.needSol)), totalQuote: sum(rows.map((r) => r.needQuote ?? 0)), shortfalls, refusal, ok: !refusal && shortfalls.length === 0 }
}

/** One line per problem, for an error message or the launch log. */
export function planProblems(plan: Plan): string[] {
  const out: string[] = []
  if (plan.refusal) out.push(`${plan.refusal.error}${plan.refusal.code ? ` · ${plan.refusal.code}` : ""}${plan.refusal.hint ? ` · ${plan.refusal.hint}` : ""}`)
  for (const s of plan.shortfalls) out.push(s.publicKey ? `send ${s.send} ${s.symbol} to ${s.publicKey} (${s.label})` : `${s.label}: create the wallet on the Wallets page first, then send it ${s.send} ${s.symbol}`)
  return out
}

/**
 * The buyers of a group with their amounts: the explicit list (every wallet must be in the folder), or the first
 * `count` wallets of the role, creating (and backing up) the missing ones. Every returned wallet has its file.
 */
function pick(role: Exclude<Role, "funding" | "trader">, g: BuyerGroup): Picked[] {
  const picked = explicit(g)
  if (picked) {
    return picked.map((b) => {
      const w = getWallet(b.publicKey)
      if (!w) throw new NotBackedUpError(b.publicKey)
      return { ...w, amount: b.amount }
    })
  }
  const have = listWallets(role).slice(0, g.count)
  const made = g.count > have.length ? createWallets(g.count - have.length, role, role) : []
  const all = [...have, ...made].map((w) => ({ ...w, amount: g.solEach }))
  for (const w of all) assertBackedUp(w.publicKey)
  return all
}

/** "0.05 SOL each", or the range when the picked amounts differ. */
function amounts(ws: Picked[], sym: string): string {
  const xs = ws.map((w) => w.amount)
  const lo = Math.min(...xs), hi = Math.max(...xs)
  return lo === hi ? `${lo} ${sym} each` : `${lo}–${hi} ${sym}`
}

/**
 * Top up every buyer in the plan from the ★ wallet (plain SOL transfers, confirmed one by one). On a custom pair
 * this is the SOL reserve only: the quote asset must reach the wallets by other means (the plan lists the amounts).
 */
export async function fundPlan(form: LaunchForm, note: (msg: string) => void = () => {}): Promise<Array<{ publicKey: string; role: string; sent: number; signature?: string; error?: string }>> {
  const api = trenchy()
  const funding = mainWallet()
  if (!funding) throw new Error("No ★ wallet yet: create or import one on the Wallets page")
  const fundingKp = keypairOf(funding.publicKey)
  const plan = await fundingPlan(form)
  if (plan.refusal) throw new ApiError(plan.refusal.error, plan.refusal.status, plan.refusal.code, plan.refusal.hint, plan.refusal.docs)
  const buyers = [...pick("bundle", form.bundle), ...pick("sniper", form.snipers), ...pick("holder", form.holders)].filter((w) => w.publicKey !== funding.publicKey)
  if (!buyers.length) return []
  const balances = new Map((await api.balances(buyers.map((b) => b.publicKey))).map((b) => [b.wallet, b.sol]))
  const out: Array<{ publicKey: string; role: string; sent: number; signature?: string; error?: string }> = []
  for (const w of buyers) {
    const need = plan.rows.find((r) => r.publicKey === w.publicKey)?.needSol ?? 0
    const topUp = Math.round((need - (balances.get(w.publicKey) ?? 0)) * 1e6) / 1e6
    if (topUp <= 0.0005) { out.push({ publicKey: w.publicKey, role: w.role, sent: 0 }); continue }
    try {
      assertBackedUp(w.publicKey)
      const signature = await api.transferSol(fundingKp, keypairOf(w.publicKey).publicKey, topUp)
      note(`${w.label}: +${topUp} SOL (${signature.slice(0, 8)}…)`)
      out.push({ publicKey: w.publicKey, role: w.role, sent: topUp, signature })
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      note(`${w.label}: funding failed: ${error}`)
      out.push({ publicKey: w.publicKey, role: w.role, sent: 0, error })
    }
  }
  if (plan.shortfalls.length) note(`Quote asset still missing (this app moves SOL only): ${planProblems(plan).join("; ")}`)
  return out
}

// ── the launch ──────────────────────────────────────────────────────────────

/** Which unit `amount` is in: the quote asset either way, under the name that reads right for the pair. */
const denom = (custom: boolean) => (custom ? { denominatedInQuote: "true" as const } : { denominatedInSol: "true" as const })
/** A buy on the curve. Custom-pair coins keep `pool: "pump"` (and `"auto"` after the launch): the API reads the pair from the coin. */
const buyBody = (publicKey: string, mint: string, amount: number, slippage: number, priorityFee: number, custom: boolean): TradeBody => ({ publicKey, action: "buy", mint, amount, ...denom(custom), slippage, priorityFee, pool: "pump" })

/** Start a launch in the background; returns the record (follow it on GET /api/launch/:id/events). */
export function startLaunch(form: LaunchForm): LaunchRecord {
  const dev = devWallet(form)
  if (!dev) throw new Error(form.devWallet ? `Dev wallet ${form.devWallet.slice(0, 8)}… is not in the folder` : "No ★ wallet yet: create or import one on the Wallets page")
  if (!form.name || !form.symbol) throw new Error("Name and symbol are required")
  if (!form.metadataUri) throw new Error("Upload the image first (the metadata URI is missing)")
  if (form.useJito && groupSize(form.bundle) > MAX_BUNDLE_WALLETS) throw new Error(`At most ${MAX_BUNDLE_WALLETS} bundle buyers (4 transactions of ${BUYERS_PER_TX} with a lookup table); add the rest as snipers or holders`)
  assertBackedUp(dev.publicKey)
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
  const rec: LaunchRecord = { id, name: form.name, symbol: form.symbol, mint: null, status: "running", createdAt: new Date().toISOString(), wallets: { dev: dev.publicKey, bundle: [], sniper: [], holder: [] }, signatures: { snipers: [], holders: [] } }
  saveLaunch(rec)
  void run(rec, form, emitter(id))
  return rec
}

async function run(rec: LaunchRecord, form: LaunchForm, emit: Emit): Promise<void> {
  const api = trenchy()
  const tipSol = effectiveSettings().jitoTipLamports / LAMPORTS_PER_SOL
  try {
    // 0. plan: the pair, the options and (custom pair) every wallet's quote-asset balance
    const plan = await fundingPlan(form)
    if (!plan.ok) throw new Error(`Not launched: ${planProblems(plan).join("; ")}`)
    const pair = await api.resolvePair(form.quoteMint)
    const custom = plan.custom
    const sym = plan.quote.symbol
    rec.quote = plan.quote; rec.mayhem = plan.mayhem; rec.holderReward = plan.holderReward; rec.creatorFeeBps = plan.creatorFeeBps
    const opts = [custom ? `paired with ${sym}` : "paired with SOL", plan.mayhem ? "Mayhem mode" : "", plan.holderReward ? "holder rewards" : "", plan.creatorFeeBps ? `creator fee ${plan.creatorFeeBps} bps` : ""].filter(Boolean)
    emit("plan", `${opts.join(" · ")}; ${plan.total.toFixed(4)} SOL${custom ? ` + ${plan.totalQuote} ${sym} across the wallets` : ""}`)

    // 1. wallets
    const devKp = keypairOf(rec.wallets.dev)
    const bundle = pick("bundle", form.bundle)
    const snipers = pick("sniper", form.snipers)
    const holders = pick("holder", form.holders)
    rec.wallets = { dev: rec.wallets.dev, bundle: bundle.map((w) => w.publicKey), sniper: snipers.map((w) => w.publicKey), holder: holders.map((w) => w.publicKey) }
    emit("wallets", `Creator ${rec.wallets.dev.slice(0, 8)}… · ${bundle.length} bundle · ${snipers.length} sniper · ${holders.length} holder wallet(s), all backed up`)

    // 2. mint
    const mintKp = form.mint.mode === "vanity" ? vanity.takeForLaunch(rec.id, form.mint.publicKey) : vanity.randomForLaunch(rec.id)
    const mint = mintKp.publicKey.toBase58()
    rec.mint = mint
    saveLaunch(rec)
    emit("mint", `Mint ${mint} (${form.mint.mode}, saved to the vanity pool)`, { mint })

    // 3. funding (SOL only; on a custom pair the plan above already made sure every wallet holds its quote asset)
    if (form.fundFirst) {
      emit("fund", `Funding buyers from the ★ wallet${custom ? " (SOL for fees; the buys are paid in " + sym + ")" : ""}…`)
      const r = await fundPlan(form, (m) => emit("fund", m))
      const failed = r.filter((x) => x.error)
      if (failed.length) throw new Error(`${failed.length} wallet(s) could not be funded; nothing launched`)
      emit("fund", `Funding done (${r.filter((x) => x.sent > 0).length} transfer(s))`)
    }

    const create = createBody(form, rec.wallets.dev, mint, pair, form.useJito ? tipSol : PRIORITY_FEE_SOL)
    let createSig: string | null = null

    if (form.useJito) {
      // 4. lookup table for 5–16 buyers
      let lookupTable: string | undefined
      if (bundle.length > PLAIN_BUNDLE_WALLETS) {
        emit("lut", `Creating a lookup table for ${bundle.length} buyers (POST /api/sol/lut)…`)
        const lut = await api.lutCreate({ authority: rec.wallets.dev, mint, wallets: bundle.map((w) => w.publicKey), creator: rec.wallets.dev, ...(custom ? { quoteMint: pair.mint } : {}) })
        for (const [i, tx] of lut.txs.entries()) {
          tx.sign([devKp])
          const { signature } = await api.send(tx)
          if (!(await api.waitConfirmed(signature, 60_000))) throw new Error(`Lookup table transaction ${i + 1}/${lut.txs.length} did not confirm`)
        }
        for (let i = 0; i < 30 && !(await api.lutInfo(lut.lookupTable).catch(() => null))?.ready; i++) await sleep(1000)
        lookupTable = lut.lookupTable
        rec.lookupTable = lookupTable
        emit("lut", `Lookup table ${lookupTable.slice(0, 8)}… ready (${lut.addresses} addresses, ${lut.rentSol.toFixed(4)} SOL rent, refunded after the launch)`)
      }

      // 5. bundle: create first, then the buys (one wallet per tx, or BUYERS_PER_TX per tx through the table)
      const groups: Picked[][] = []
      bundle.forEach((w, i) => { if (i % (lookupTable ? BUYERS_PER_TX : 1) === 0) groups.push([]); groups[groups.length - 1].push(w) })
      const buys: TradeBody[] = groups.map((g) => lookupTable
        ? { action: "buy", mint, lookupTable, ...denom(custom), slippage: form.slippage, priorityFee: 0, buyers: g.map((w) => ({ publicKey: w.publicKey, amount: w.amount })) }
        : buyBody(g[0].publicKey, mint, g[0].amount, form.slippage, 0, custom))
      emit("build", `Building the bundle: create + dev buy ${form.devBuySol} ${sym}${bundle.length ? ` + ${bundle.length} buyer(s) in ${groups.length} tx` : ""}, tip ${tipSol} SOL (POST /api/sol/trade-local)`)
      const built: BuiltTx[] = await api.bundleLocal([create, ...buys])
      built[0].tx.sign([devKp, mintKp])
      groups.forEach((g, i) => built[i + 1].tx.sign(g.map((w) => keypairOf(w.publicKey))))

      // only the create can be simulated alone: the buys need the coin to exist
      const sim = await api.simulate(built[0].tx).catch(() => null)
      if (sim && !sim.ok) emit("warning", `Create simulation failed: ${JSON.stringify(sim.err)} ${sim.logs.slice(-2).join(" | ")}`)
      else if (sim) emit("simulate", `Create + dev buy simulates (${sim.unitsConsumed ?? "?"} CU, ~${Math.round(built[0].expected.tokens).toLocaleString()} tokens for ${built[0].expected.quoteAmount} ${built[0].quote.symbol})`)

      let landed = false
      try {
        const r = await api.bundle(built.map((b) => b.tx))
        rec.signatures.bundleId = r.bundleId
        emit("bundle", `Bundle accepted by Jito (${r.region}): ${r.bundleId} (POST /api/sol/bundle)`)
        let status = "unknown"
        for (const t0 = Date.now(); Date.now() - t0 < 45_000 && !/^(landed|failed|invalid)$/i.test(status); ) {
          await sleep(2000)
          status = (await api.bundleStatus(r.bundleId).catch(() => ({ status: "unknown" }))).status || "unknown"
        }
        emit("bundle", `Jito bundle status: ${status}`)
        if (await api.waitConfirmed(r.signatures[0], 45_000, (m) => emit("confirm", m))) { createSig = r.signatures[0]; landed = true }
      } catch (e) {
        emit("warning", `Jito refused the bundle: ${e instanceof Error ? e.message : e}`)
      }

      if (landed) {
        emit("confirm", `Create confirmed in the bundle (${createSig!.slice(0, 12)}…)`, { signature: createSig! })
      } else {
        // fallback: the create alone through POST /api/sol/send, then each buyer one by one
        emit("fallback", "Bundle did not land; sending the create on its own, then the buys…")
        const plain = await api.tradeLocal({ ...create, priorityFee: PRIORITY_FEE_SOL })
        plain.tx.sign([devKp, mintKp])
        createSig = (await api.send(plain.tx)).signature
        if (!(await api.waitConfirmed(createSig, 60_000, (m) => emit("confirm", m)))) throw new Error(`Create ${createSig.slice(0, 12)}… not confirmed`)
        emit("confirm", `Create confirmed (${createSig.slice(0, 12)}…)`, { signature: createSig })
        await sequentialBuys(api, mint, bundle, form.slippage, 0, emit, "bundle", custom, sym)
      }
      if (lookupTable) void closeLut(api, lookupTable, devKp, (m) => emit("lut", m))
    } else {
      // no Jito: create, then buys one by one
      emit("build", `Building the create + dev buy ${form.devBuySol} ${sym} (POST /api/sol/trade-local)`)
      const plain = await api.tradeLocal(create)
      plain.tx.sign([devKp, mintKp])
      createSig = (await api.send(plain.tx)).signature
      if (!(await api.waitConfirmed(createSig, 60_000, (m) => emit("confirm", m)))) throw new Error(`Create ${createSig.slice(0, 12)}… not confirmed`)
      emit("confirm", `Create confirmed (${createSig.slice(0, 12)}…)`, { signature: createSig })
      await sequentialBuys(api, mint, bundle, form.slippage, 0, emit, "bundle", custom, sym)
    }

    rec.signatures.create = createSig!
    rec.status = "confirmed"
    saveLaunch(rec)
    emit("live", `Live on pump.fun: https://pump.fun/coin/${mint}${plan.mayhem ? " (Mayhem: pump.fun's agent trades it for 24 h)" : ""}`, { mint, signature: createSig!, link: `https://pump.fun/coin/${mint}` })

    // 6. snipers: right now, staggered
    if (snipers.length) {
      emit("snipers", `${snipers.length} sniper buy(s) of ${amounts(snipers, sym)}, ${form.snipers.gapMs} ms apart`)
      rec.signatures.snipers = await sequentialBuys(api, mint, snipers, form.slippage, form.snipers.gapMs, emit, "sniper", custom, sym)
      saveLaunch(rec)
    }

    // 7. holders: after a delay, spread over a window with jitter
    if (holders.length) {
      emit("holders", `${holders.length} holder buy(s) of ${amounts(holders, sym)} after ${form.holders.delayS}s, spread over ${form.holders.windowS}s`)
      await sleep(form.holders.delayS * 1000)
      const times = holders.map(() => Math.random() * form.holders.windowS * 1000).sort((a, b) => a - b)
      const t0 = Date.now()
      for (const [i, w] of holders.entries()) {
        await sleep(Math.max(0, t0 + times[i] - Date.now()))
        const sig = await oneBuy(api, mint, w, w.amount, form.slippage, emit, "holder", custom, sym)
        if (sig) rec.signatures.holders.push(sig)
      }
      saveLaunch(rec)
    }
    emit("done", "Launch complete", { mint, link: `https://pump.fun/coin/${mint}` })
  } catch (e) {
    rec.status = "error"
    rec.error = e instanceof ApiError ? `${e.message}${e.code ? ` · ${e.code}` : ""}${e.hint ? ` · ${e.hint}` : ""}` : e instanceof Error ? e.message : String(e)
    saveLaunch(rec)
    emit("error", rec.error)
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** One buy: trade-local → sign → send. Failures are logged, never fatal for the launch. `amount` is in the quote asset. */
async function oneBuy(api: Trenchy, mint: string, w: WalletInfo, amount: number, slippage: number, emit: Emit, stage: string, custom: boolean, sym: string): Promise<string | null> {
  try {
    const built = await api.tradeLocal(buyBody(w.publicKey, mint, amount, Math.max(slippage, 20), PRIORITY_FEE_SOL, custom))
    built.tx.sign([keypairOf(w.publicKey)])
    const { signature } = await api.send(built.tx)
    emit(stage, `${w.label} bought ${amount} ${sym} (${signature.slice(0, 12)}…)`, { signature })
    return signature
  } catch (e) {
    emit("warning", `${w.label} buy failed: ${e instanceof Error ? e.message : e}`)
    return null
  }
}

async function sequentialBuys(api: Trenchy, mint: string, wallets: Picked[], slippage: number, gapMs: number, emit: Emit, stage: string, custom: boolean, sym: string): Promise<string[]> {
  const sigs: string[] = []
  for (const [i, w] of wallets.entries()) {
    if (i > 0 && gapMs > 0) await sleep(gapMs)
    const sig = await oneBuy(api, mint, w, w.amount, slippage, emit, stage, custom, sym)
    if (sig) sigs.push(sig)
  }
  return sigs
}

/** Deactivate the table now; close it once the chain allows (~4 min, 409 cooling_down before), refunding the rent to the dev. */
async function closeLut(api: Trenchy, lookupTable: string, authority: Keypair, note: (m: string) => void): Promise<void> {
  try {
    const tx = await api.lutStep(lookupTable, "deactivate", authority.publicKey.toBase58())
    tx.sign([authority])
    await api.send(tx)
    note("Lookup table deactivated; closing it in ~4 minutes to refund the rent")
  } catch (e) {
    note(`Lookup table deactivate failed: ${e instanceof Error ? e.message : e}`)
    return
  }
  for (let i = 0; i < 8; i++) {
    await sleep(i === 0 ? 4.5 * 60_000 : 30_000)
    try {
      const tx = await api.lutStep(lookupTable, "close", authority.publicKey.toBase58())
      tx.sign([authority])
      const { signature } = await api.send(tx)
      note(`Lookup table closed, rent refunded (${signature.slice(0, 12)}…)`)
      return
    } catch (e) {
      if (!(e instanceof ApiError && e.code === "cooling_down")) { note(`Lookup table close failed: ${e instanceof Error ? e.message : e}`); return }
    }
  }
}

// ── simulate ────────────────────────────────────────────────────────────────

export type SimulateResult = { ok: boolean; checks: Array<{ name: string; ok: boolean; detail: string }>; plan: Plan; simulation: Simulation | null; expected: Expected | null; quote: Quote }

/**
 * Dry run, nothing is sent: API reachable, funding wallet backed up and holding enough SOL for the plan (and, on a
 * custom pair, every wallet holding its quote asset), then the create + dev buy is built (POST /api/sol/trade-local,
 * funding wallet as creator, a throwaway mint, the form's pair / Mayhem / holder-reward / creator-fee options) and
 * run through POST /api/sol/simulate. The API's answer is returned as is.
 */
export async function simulateLaunch(form: LaunchForm): Promise<SimulateResult> {
  const api = trenchy()
  const checks: SimulateResult["checks"] = []
  const plan = await fundingPlan(form)
  const funding = devWallet(form)
  if (!funding) throw new Error(form.devWallet ? `Dev wallet ${form.devWallet.slice(0, 8)}… is not in the folder` : "No ★ wallet yet: create or import one on the Wallets page")
  assertBackedUp(funding.publicKey)
  checks.push({ name: "backup", ok: true, detail: `dev wallet ${funding.publicKey.slice(0, 8)}… has its file (${funding.file})` })

  const me = await api.me()
  checks.push({ name: "api", ok: true, detail: `connected to ${api.url} (key ${me.keyPrefix ?? "…"})` })
  const balance = await api.solBalance(funding.publicKey)
  checks.push({ name: "balance", ok: balance >= plan.total, detail: `dev wallet holds ${balance.toFixed(4)} SOL, the plan needs ${plan.total.toFixed(4)} SOL${plan.custom ? " (network fees + our fee; the buys are paid in " + plan.quote.symbol + ")" : ""}` })
  if (plan.custom) checks.push({ name: "pair", ok: plan.shortfalls.length === 0, detail: plan.shortfalls.length ? `short of ${plan.quote.symbol}: ${planProblems({ ...plan, refusal: null }).join("; ")}` : `every wallet holds its ${plan.quote.symbol} (${plan.totalQuote} ${plan.quote.symbol} across the plan)` })
  if (plan.refusal) checks.push({ name: "options", ok: false, detail: planProblems({ ...plan, shortfalls: [] })[0] })
  checks.push({ name: "metadata", ok: !!form.metadataUri, detail: form.metadataUri ? `metadata ${form.metadataUri}` : "no metadata URI yet: upload the image first" })
  if (form.useJito && groupSize(form.bundle) > MAX_BUNDLE_WALLETS) checks.push({ name: "bundle", ok: false, detail: `at most ${MAX_BUNDLE_WALLETS} bundle buyers in one Jito bundle` })
  // refused options, or a dev wallet short of the quote asset: the build would fail with the same message, so stop here
  if (plan.refusal || plan.shortfalls.some((s) => s.role === "dev")) return { ok: false, checks, plan, simulation: null, expected: null, quote: plan.quote }

  // The simulated create uses a throwaway mint that is never stored or created on chain.
  const pair = await api.resolvePair(form.quoteMint)
  const mintKp = Keypair.generate()
  const built = await api.tradeLocal(createBody({ ...form, name: form.name || "Simulation", symbol: form.symbol || "SIM" }, funding.publicKey, mintKp.publicKey.toBase58(), pair, PRIORITY_FEE_SOL, form.metadataUri || "https://trenchytools.lol/simulate.json"))
  built.tx.sign([keypairOf(funding.publicKey), mintKp])
  const simulation = await api.simulate(built.tx)
  checks.push({ name: "simulation", ok: simulation.ok, detail: simulation.ok ? `create + dev buy simulates fine (${simulation.unitsConsumed ?? "?"} CU, ~${Math.round(built.expected.tokens).toLocaleString()} tokens for ${form.devBuySol} ${built.quote.symbol}${built.mayhem?.enabled ? ", Mayhem mode" : ""})` : `simulation failed: ${JSON.stringify(simulation.err)}` })
  return { ok: checks.every((c) => c.ok), checks, plan, simulation, expected: built.expected, quote: built.quote }
}
