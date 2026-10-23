/**
 * Trading after the launch. Every trade is built by POST /api/sol/trade-local with `pool: "auto"` (follows the coin
 * from the pump.fun curve to PumpSwap), signed with the wallet's key from the folder, sent with POST /api/sol/send
 * and confirmed with GET /api/sol/tx/:signature. Live trades come from the API websocket (subscribeTokenTrade).
 */
import WebSocket from "ws"
import { readLaunches } from "./launch"
import { serverState } from "./paths"
import { effectiveSettings } from "./settings"
import { trenchy, type Expected, type Quote, type TokenInfo } from "./trenchy"
import { assertBackedUp, fundingWallet, keypairOf, listWallets, type WalletInfo } from "./wallets"

const PRIORITY_FEE_SOL = 0.0005

export type Holding = WalletInfo & { sol: number; tokens: number; raw: string }

/** Every wallet in the folder with its SOL and this coin's balance (GET /api/sol/balances?wallets=…&mint=…). */
export async function holdings(mint: string): Promise<Holding[]> {
  const wallets = listWallets()
  if (!wallets.length) return []
  const rows = await trenchy().balances(wallets.map((w) => w.publicKey), mint)
  const by = new Map(rows.map((r) => [r.wallet, r]))
  return wallets.map((w) => ({ ...w, sol: by.get(w.publicKey)?.sol ?? 0, tokens: by.get(w.publicKey)?.token?.balance ?? 0, raw: by.get(w.publicKey)?.token?.raw ?? "0" }))
}

/**
 * GET /api/sol/token/:mint: what the coin is priced in (`quote`), whether it is a Mayhem coin, holder rewards, creator
 * fee. The pages label every amount with `quote.symbol`; a coin the API does not know yet answers with SOL.
 */
export async function tokenInfo(mint: string): Promise<TokenInfo & { quote: Quote; custom: boolean }> {
  const t = await trenchy().token(mint)
  const quote: Quote = t.quote ?? { mint: "So11111111111111111111111111111111111111112", symbol: "SOL", decimals: 9, kind: "sol" }
  return { ...t, quote, custom: quote.symbol !== "SOL" }
}

/** `expected.quoteAmount` is in the coin's quote asset (`quote.symbol`); `sol` is set on SOL coins only. */
export type TradeResult = { publicKey: string; signature: string; action: "buy" | "sell"; expected: Expected; quote: Quote; venue?: string; confirmed: boolean }

/** One wallet sells `percent` of its balance ("NN%" is resolved by the API from the real balance). */
export async function sell(publicKey: string, mint: string, percent: number, slippage = effectiveSettings().slippage): Promise<TradeResult> {
  const api = trenchy()
  const pct = Math.max(1, Math.min(100, Math.round(percent)))
  const kp = keypairOf(publicKey) // the key must be on disk: NotBackedUpError otherwise
  const built = await api.tradeLocal({ publicKey, action: "sell", mint, amount: `${pct}%`, denominatedInQuote: "false", slippage, priorityFee: PRIORITY_FEE_SOL, pool: "auto" })
  built.tx.sign([kp])
  const { signature } = await api.send(built.tx)
  const confirmed = await api.waitConfirmed(signature, 45_000)
  return { publicKey, signature, action: "sell", expected: built.expected, quote: built.quote, venue: built.venue, confirmed }
}

/**
 * One wallet buys for `amount` of the coin's quote asset (SOL on a SOL coin; USDC / the stock / the coin on a custom
 * pair: the wallet must hold it, 409 no_quote_balance otherwise). `partialFill` is for Mayhem coins only: a buy past
 * the remaining supply takes what is left instead of failing.
 */
export async function buy(publicKey: string, mint: string, amount: number, slippage = effectiveSettings().slippage, partialFill = false): Promise<TradeResult> {
  const api = trenchy()
  assertBackedUp(publicKey)
  const kp = keypairOf(publicKey)
  const built = await api.tradeLocal({ publicKey, action: "buy", mint, amount, denominatedInQuote: "true", slippage, priorityFee: PRIORITY_FEE_SOL, pool: "auto", ...(partialFill ? { partialFill: true } : {}) })
  built.tx.sign([kp])
  const { signature } = await api.send(built.tx)
  const confirmed = await api.waitConfirmed(signature, 45_000)
  return { publicKey, signature, action: "buy", expected: built.expected, quote: built.quote, venue: built.venue, confirmed }
}

export type SellAllResult = Array<TradeResult | { publicKey: string; skipped?: string; error?: string; code?: string }>

/** Sell `percent` from each wallet, one after the other (wallets holding none are skipped). */
export async function sellAll(publicKeys: string[], mint: string, percent: number): Promise<SellAllResult> {
  const rows = await trenchy().balances(publicKeys, mint)
  const held = new Map(rows.map((r) => [r.wallet, r.token?.raw ?? "0"]))
  const out: SellAllResult = []
  for (const pk of publicKeys) {
    if ((held.get(pk) ?? "0") === "0") { out.push({ publicKey: pk, skipped: "holds none" }); continue }
    try {
      out.push(await sell(pk, mint, percent))
    } catch (e) {
      out.push({ publicKey: pk, error: e instanceof Error ? e.message : String(e), code: (e as { code?: string })?.code })
    }
  }
  return out
}

/** The creator of a coin we launched (from launches.json), else the funding wallet. */
export function creatorOf(mint: string): string | null {
  return readLaunches().find((l) => l.mint === mint)?.wallets.dev ?? fundingWallet()?.publicKey ?? null
}

/** GET /api/sol/creator-fees for the coin's creator. */
export async function creatorFees(mint: string) {
  const creator = creatorOf(mint)
  if (!creator) throw new Error("No creator wallet known for this coin")
  const fees = await trenchy().creatorFees(creator)
  return { creator, sol: fees.sol, lamports: fees.lamports }
}

/** Claim them: trade-local { action: "collectCreatorFee" } signed by the creator. */
export async function collectCreatorFees(mint: string): Promise<{ creator: string; signature: string; confirmed: boolean }> {
  const creator = creatorOf(mint)
  if (!creator) throw new Error("No creator wallet known for this coin")
  const api = trenchy()
  const kp = keypairOf(creator)
  const built = await api.tradeLocal({ publicKey: creator, action: "collectCreatorFee", priorityFee: 0.0001 })
  built.tx.sign([kp])
  const { signature } = await api.send(built.tx)
  return { creator, signature, confirmed: await api.waitConfirmed(signature, 45_000) }
}

// ── live trades: one websocket to wss://…/api/sol/data, subscribeTokenTrade per coin ─────────────────────────────

export type LiveTrade = { signature: string; mint: string; type: "buy" | "sell"; trader: string; sol: number; tokens: number; marketCapSol: number | null; timestamp: number; ours: string | null; pool: string | null }

type Feed = { ws: WebSocket | null; url: string | null; mint: string | null; trades: LiveTrade[]; seen: Set<string>; listeners: Set<(t: LiveTrade) => void> }
const feed = serverState<Feed>("feed", () => ({ ws: null, url: null, mint: null, trades: [], seen: new Set(), listeners: new Set() }))

function connect(): void {
  if (!feed.url) return
  const ws = new WebSocket(feed.url)
  feed.ws = ws
  ws.on("open", () => { if (feed.mint) ws.send(JSON.stringify({ method: "subscribeTokenTrade", keys: [feed.mint] })) })
  ws.on("message", (data) => {
    try {
      const raw = JSON.parse(data.toString()) as Record<string, unknown>
      if ((raw.txType !== "buy" && raw.txType !== "sell") || raw.mint !== feed.mint) return
      const sig = String(raw.signature ?? "")
      if (!sig || feed.seen.has(sig)) return
      feed.seen.add(sig)
      const trader = String(raw.traderPublicKey ?? "")
      const ours = listWallets().find((w) => w.publicKey === trader)
      const t: LiveTrade = {
        signature: sig, mint: feed.mint!, type: raw.txType, trader,
        sol: Number(raw.solAmount ?? 0), tokens: Number(raw.tokenAmount ?? 0), marketCapSol: typeof raw.marketCapSol === "number" ? raw.marketCapSol : null,
        timestamp: typeof raw.timestamp === "number" ? raw.timestamp : Date.now(), ours: ours ? `${ours.label} · ${ours.role}` : null, pool: typeof raw.pool === "string" ? raw.pool : null,
      }
      feed.trades.unshift(t)
      if (feed.trades.length > 200) feed.trades.length = 200
      for (const cb of feed.listeners) cb(t)
    } catch { /* not a trade */ }
  })
  ws.on("close", () => { if (feed.ws === ws && feed.mint) setTimeout(connect, 3000) })
  ws.on("error", (e) => console.warn("[feed]", e.message))
}

/** Follow one coin (the previous one is dropped). Returns the trades seen so far. */
export function followMint(mint: string): LiveTrade[] {
  const api = trenchy()
  const url = api.configured ? api.wsUrl() : null
  if (url !== feed.url || !feed.ws || feed.ws.readyState > WebSocket.OPEN) {
    feed.url = url
    try { feed.ws?.close() } catch { /* closing */ }
    feed.ws = null
    feed.mint = mint
    feed.trades = []
    feed.seen = new Set()
    connect()
  } else if (feed.mint !== mint) {
    if (feed.mint && feed.ws.readyState === WebSocket.OPEN) feed.ws.send(JSON.stringify({ method: "unsubscribeTokenTrade", keys: [feed.mint] }))
    feed.mint = mint
    feed.trades = []
    feed.seen = new Set()
    if (feed.ws.readyState === WebSocket.OPEN) feed.ws.send(JSON.stringify({ method: "subscribeTokenTrade", keys: [mint] }))
  }
  return feed.trades
}

export function onTrade(cb: (t: LiveTrade) => void): () => void {
  feed.listeners.add(cb)
  return () => feed.listeners.delete(cb)
}
