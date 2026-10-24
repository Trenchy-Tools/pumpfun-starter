/**
 * Trading after the launch, shared by local mode (lib/trading.ts) and demo mode (lib/browser/engine.ts). Every trade is
 * built by POST /api/sol/trade-local with `pool: "auto"` (follows the coin from the pump.fun curve to PumpSwap), signed
 * with the wallet's key from the store, sent with POST /api/sol/send and confirmed with GET /api/sol/tx/:signature.
 * Live trades come from the API websocket (subscribeTokenTrade); `parseTrade` turns one message into a LiveTrade.
 * No node imports.
 */
import type { Expected, Quote, TokenInfo } from "../trenchy"
import type { Env } from "./launch"
import type { WalletInfo } from "./wallet-record"

const PRIORITY_FEE_SOL = 0.0005

export type Holding = WalletInfo & { sol: number; tokens: number; raw: string }

/** Every wallet with its SOL and this coin's balance (GET /api/sol/balances?wallets=…&mint=…). */
export async function holdings(env: Env, mint: string): Promise<Holding[]> {
  const wallets = env.wallets.list()
  if (!wallets.length) return []
  const rows = await env.api.balances(wallets.map((w) => w.publicKey), mint)
  const by = new Map(rows.map((r) => [r.wallet, r]))
  return wallets.map((w) => ({ ...w, sol: by.get(w.publicKey)?.sol ?? 0, tokens: by.get(w.publicKey)?.token?.balance ?? 0, raw: by.get(w.publicKey)?.token?.raw ?? "0" }))
}

/**
 * GET /api/sol/token/:mint: what the coin is priced in (`quote`), whether it is a Mayhem coin, holder rewards, creator
 * fee. The pages label every amount with `quote.symbol`; a coin the API does not know yet answers with SOL.
 */
export async function tokenInfo(env: Env, mint: string): Promise<TokenInfo & { quote: Quote; custom: boolean }> {
  const t = await env.api.token(mint)
  const quote: Quote = t.quote ?? { mint: "So11111111111111111111111111111111111111112", symbol: "SOL", decimals: 9, kind: "sol" }
  return { ...t, quote, custom: quote.symbol !== "SOL" }
}

/**
 * GET /api/wallets/balances: every wallet's SOL (`native`, the field the pons starter fills with ETH), the coin's balance
 * when `mint` is given, and the balance of a custom pair's quote asset (`quote`) when `quoteMint` is given.
 */
export async function balanceRows(env: Env, mint?: string, quoteMint?: string) {
  const wallets = env.wallets.list()
  if (!wallets.length) return { rows: [] as Array<{ publicKey: string; native: number; sol: number; tokens: number; raw: string; quote?: number }> }
  const keys = wallets.map((w) => w.publicKey)
  const [rows, quotes] = await Promise.all([env.api.balances(keys, mint), quoteMint ? env.api.balances(keys, quoteMint) : Promise.resolve(null)])
  const quoteBy = new Map((quotes ?? []).map((r) => [r.wallet, r.token?.balance ?? 0]))
  return { mint: mint ?? null, quoteMint: quoteMint ?? null, rows: rows.map((r) => ({ publicKey: r.wallet, native: r.sol, sol: r.sol, tokens: r.token?.balance ?? 0, raw: r.token?.raw ?? "0", ...(quoteMint ? { quote: quoteBy.get(r.wallet) ?? 0 } : {}) })) }
}

/** `expected.quoteAmount` is in the coin's quote asset (`quote.symbol`); `sol` is set on SOL coins only. */
export type TradeResult = { publicKey: string; signature: string; action: "buy" | "sell"; expected: Expected; quote: Quote; venue?: string; confirmed: boolean }

/** One wallet sells `percent` of its balance ("NN%" is resolved by the API from the real balance). */
export async function sell(env: Env, publicKey: string, mint: string, percent: number, slippage = env.slippage): Promise<TradeResult> {
  const api = env.api
  const pct = Math.max(1, Math.min(100, Math.round(percent)))
  const kp = env.wallets.keypairOf(publicKey) // the key must be backed up: NotBackedUpError otherwise
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
export async function buy(env: Env, publicKey: string, mint: string, amount: number, slippage = env.slippage, partialFill = false): Promise<TradeResult> {
  const api = env.api
  env.wallets.assertBackedUp(publicKey)
  const kp = env.wallets.keypairOf(publicKey)
  const built = await api.tradeLocal({ publicKey, action: "buy", mint, amount, denominatedInQuote: "true", slippage, priorityFee: PRIORITY_FEE_SOL, pool: "auto", ...(partialFill ? { partialFill: true } : {}) })
  built.tx.sign([kp])
  const { signature } = await api.send(built.tx)
  const confirmed = await api.waitConfirmed(signature, 45_000)
  return { publicKey, signature, action: "buy", expected: built.expected, quote: built.quote, venue: built.venue, confirmed }
}

export type SellAllResult = Array<TradeResult | { publicKey: string; skipped?: string; error?: string; code?: string }>

/** Sell `percent` from each wallet, one after the other (wallets holding none are skipped). */
export async function sellAll(env: Env, publicKeys: string[], mint: string, percent: number): Promise<SellAllResult> {
  const rows = await env.api.balances(publicKeys, mint)
  const held = new Map(rows.map((r) => [r.wallet, r.token?.raw ?? "0"]))
  const out: SellAllResult = []
  for (const pk of publicKeys) {
    if ((held.get(pk) ?? "0") === "0") { out.push({ publicKey: pk, skipped: "holds none" }); continue }
    try {
      out.push(await sell(env, pk, mint, percent))
    } catch (e) {
      out.push({ publicKey: pk, error: e instanceof Error ? e.message : String(e), code: (e as { code?: string })?.code })
    }
  }
  return out
}

/** The creator of a coin we launched (from the launch records), else the ★ wallet. */
export function creatorOf(env: Env, mint: string): string | null {
  return env.launches.list().find((l) => l.mint === mint)?.wallets.dev ?? env.wallets.main()?.publicKey ?? null
}

/** GET /api/sol/creator-fees for the coin's creator. */
export async function creatorFees(env: Env, mint: string) {
  const creator = creatorOf(env, mint)
  if (!creator) throw new Error("No creator wallet known for this coin")
  const fees = await env.api.creatorFees(creator)
  return { creator, sol: fees.sol, lamports: fees.lamports }
}

/** Claim them: trade-local { action: "collectCreatorFee" } signed by the creator. */
export async function collectCreatorFees(env: Env, mint: string): Promise<{ creator: string; signature: string; confirmed: boolean }> {
  const creator = creatorOf(env, mint)
  if (!creator) throw new Error("No creator wallet known for this coin")
  const api = env.api
  const kp = env.wallets.keypairOf(creator)
  const built = await api.tradeLocal({ publicKey: creator, action: "collectCreatorFee", priorityFee: 0.0001 })
  built.tx.sign([kp])
  const { signature } = await api.send(built.tx)
  return { creator, signature, confirmed: await api.waitConfirmed(signature, 45_000) }
}

// ── live trades ─────────────────────────────────────────────────────────────

export type LiveTrade = { signature: string; mint: string; type: "buy" | "sell"; trader: string; sol: number; tokens: number; marketCapSol: number | null; timestamp: number; ours: string | null; pool: string | null }

/** The subscribe message for one coin on wss://…/api/sol/data. */
export const tradeSubscription = (mint: string, on = true) => JSON.stringify({ method: on ? "subscribeTokenTrade" : "unsubscribeTokenTrade", keys: [mint] })

/** One websocket message → a trade of `mint`, or null (not a trade, another coin). `ours` labels our own wallets. */
export function parseTrade(data: string, mint: string, ours: (trader: string) => WalletInfo | undefined): LiveTrade | null {
  try {
    const raw = JSON.parse(data) as Record<string, unknown>
    if ((raw.txType !== "buy" && raw.txType !== "sell") || raw.mint !== mint) return null
    const sig = String(raw.signature ?? "")
    if (!sig) return null
    const trader = String(raw.traderPublicKey ?? "")
    const w = ours(trader)
    return {
      signature: sig, mint, type: raw.txType, trader,
      sol: Number(raw.solAmount ?? 0), tokens: Number(raw.tokenAmount ?? 0), marketCapSol: typeof raw.marketCapSol === "number" ? raw.marketCapSol : null,
      timestamp: typeof raw.timestamp === "number" ? raw.timestamp : Date.now(), ours: w ? `${w.label} · ${w.role}` : null, pool: typeof raw.pool === "string" ? raw.pool : null,
    }
  } catch {
    return null // not a trade
  }
}
