/**
 * Trading after the launch, in local mode: the flows in lib/core/trading.ts run on the wallet folder (lib/env.ts).
 * Live trades come from the API websocket (subscribeTokenTrade), held in server memory and relayed to the page as
 * server-sent events.
 */
import WebSocket from "ws"
import * as core from "./core/trading"
import { serverEnv } from "./env"
import { serverState } from "./paths"
import { trenchy } from "./settings"
import { listWallets } from "./wallets"
import type { LiveTrade, SellAllResult, TradeResult } from "./core/trading"

export type { Holding, LiveTrade, SellAllResult, TradeResult } from "./core/trading"

export const holdings = (mint: string) => core.holdings(serverEnv(), mint)
export const tokenInfo = (mint: string) => core.tokenInfo(serverEnv(), mint)
export const sell = (publicKey: string, mint: string, percent: number, slippage?: number): Promise<TradeResult> => core.sell(serverEnv(), publicKey, mint, percent, slippage)
export const buy = (publicKey: string, mint: string, amount: number, slippage?: number, partialFill = false): Promise<TradeResult> => core.buy(serverEnv(), publicKey, mint, amount, slippage, partialFill)
export const sellAll = (publicKeys: string[], mint: string, percent: number): Promise<SellAllResult> => core.sellAll(serverEnv(), publicKeys, mint, percent)
export const creatorOf = (mint: string) => core.creatorOf(serverEnv(), mint)
export const creatorFees = (mint: string) => core.creatorFees(serverEnv(), mint)
export const collectCreatorFees = (mint: string) => core.collectCreatorFees(serverEnv(), mint)

// ── live trades: one websocket to wss://…/api/sol/data, subscribeTokenTrade per coin ─────────────────────────────

type Feed = { ws: WebSocket | null; url: string | null; mint: string | null; trades: LiveTrade[]; seen: Set<string>; listeners: Set<(t: LiveTrade) => void>; backfilled: string | null }
const feed = serverState<Feed>("feed", () => ({ ws: null, url: null, mint: null, trades: [], seen: new Set(), listeners: new Set(), backfilled: null }))

/**
 * The coin's history (GET /api/sol/trades: the dev buy, the bundle, everything before this page subscribed), merged
 * into the tape once per followed coin. Returns the whole tape, newest first.
 */
export async function backfillMint(mint: string): Promise<LiveTrade[]> {
  if (feed.mint !== mint || feed.backfilled === mint) return feed.trades
  feed.backfilled = mint
  const api = trenchy()
  if (!api.configured) return feed.trades
  try {
    const h = await api.tradeHistory(mint, 100)
    const lookup = (trader: string) => listWallets().find((w) => w.publicKey === trader)
    for (const raw of h.trades) {
      const t = core.parseTrade(JSON.stringify(raw), mint, lookup)
      if (!t || feed.seen.has(t.signature)) continue
      feed.seen.add(t.signature)
      feed.trades.push(t)
    }
    feed.trades.sort((a, b) => b.timestamp - a.timestamp)
    if (feed.trades.length > 300) feed.trades.length = 300
  } catch (e) { console.warn("[feed] history:", e instanceof Error ? e.message : e) }
  return feed.trades
}

function connect(): void {
  if (!feed.url) return
  const ws = new WebSocket(feed.url)
  feed.ws = ws
  ws.on("open", () => { if (feed.mint) ws.send(core.tradeSubscription(feed.mint)) })
  ws.on("message", (data) => {
    if (!feed.mint) return
    const t = core.parseTrade(data.toString(), feed.mint, (trader) => listWallets().find((w) => w.publicKey === trader))
    if (!t || feed.seen.has(t.signature)) return
    feed.seen.add(t.signature)
    feed.trades.unshift(t)
    if (feed.trades.length > 200) feed.trades.length = 200
    for (const cb of feed.listeners) cb(t)
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
    if (feed.mint && feed.ws.readyState === WebSocket.OPEN) feed.ws.send(core.tradeSubscription(feed.mint, false))
    feed.mint = mint
    feed.trades = []
    feed.seen = new Set()
    if (feed.ws.readyState === WebSocket.OPEN) feed.ws.send(core.tradeSubscription(mint))
  }
  return feed.trades
}

export function onTrade(cb: (t: LiveTrade) => void): () => void {
  feed.listeners.add(cb)
  return () => feed.listeners.delete(cb)
}
