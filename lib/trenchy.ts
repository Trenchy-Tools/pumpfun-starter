/**
 * The TrenchyTools API client: the one file that talks to https://api.trenchytools.lol.
 *
 * Every method names the endpoint it calls. The API builds transactions and sends them; this app signs them locally
 * with keys from the wallet folder and never talks to an RPC node, Jito or IPFS itself.
 *
 * Copy this file into your own project. It depends only on @solana/web3.js and bs58. Docs for every endpoint:
 * https://api.trenchytools.lol/AGENTS.md and https://trenchytools-docs-production.up.railway.app/openapi.json
 */
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
  type TransactionInstruction,
} from "@solana/web3.js"
import bs58 from "bs58"
import { effectiveSettings } from "./settings"

/**
 * Every API error body is `{ error, code, hint?, docs? }` plus, on some codes, extra fields: `no_quote_balance` carries
 * `needed`, `have`, `quote` and the `account` to fund; `creator_fee_not_allowed` carries `min` / `max`. All of it rides
 * along here (`extra`); show it verbatim, branch on `code`.
 */
export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string, public hint?: string, public docs?: string, public extra: Record<string, unknown> = {}) {
    super(message)
    this.name = "ApiError"
  }
  /** `needed` / `have` / `quote` / `account` of a 409 no_quote_balance, typed. */
  get quoteShortfall(): { needed: number; have: number; quote: Quote; account: string } | null {
    if (this.code !== "no_quote_balance") return null
    const q = this.extra.quote as Quote | undefined
    return { needed: Number(this.extra.needed ?? 0), have: Number(this.extra.have ?? 0), quote: q ?? SOL_QUOTE, account: String(this.extra.account ?? "") }
  }
  toJSON() {
    return { ...this.extra, error: this.message, code: this.code, hint: this.hint, docs: this.docs, status: this.status }
  }
}

// ── shapes ──────────────────────────────────────────────────────────────────

/** What a coin is priced and traded in. SOL for ordinary coins; USDC / a stock / another coin on a custom pair. */
export type Quote = { mint: string; symbol: string; decimals: number; kind?: PairKind }
export const SOL_MINT = "So11111111111111111111111111111111111111112"
export const SOL_QUOTE: Quote = { mint: SOL_MINT, symbol: "SOL", decimals: 9, kind: "sol" }
export const isSolQuote = (q: { mint: string } | null | undefined) => !q || q.mint === SOL_MINT

export type PairKind = "sol" | "stable" | "stock" | "crypto" | "pump"
/** One entry of GET /api/sol/pairs: a quote asset a coin can be launched in. */
export type Pair = {
  mint: string; symbol: string; name?: string | null; decimals: number; tokenProgram: string
  source: "sol" | "global" | "quoteControl" | "pumpCoin"; kind: PairKind
  initialVirtualQuoteReserves: string; feeSchedule: "tiers" | "stable" | "exotic"
}
export type Pairs = { pairs: Pair[]; checkedAt: number }
/** SOL as a pair entry: the default, and the fallback when GET /api/sol/pairs cannot be read. */
export const SOL_PAIR: Pair = { mint: SOL_MINT, symbol: "SOL", name: "Solana", decimals: 9, tokenProgram: "", source: "sol", kind: "sol", initialVirtualQuoteReserves: "", feeSchedule: "tiers" }

/** `tokens` bought or sold; `quoteAmount` in the coin's quote asset; `sol` only on SOL coins (same number as quoteAmount). */
export type Expected = { tokens: number; quoteAmount: number; sol?: number }
/** One entry of POST /api/sol/trade-local (a single object, or one element of a bundle array). */
export type TradeBody = {
  publicKey?: string
  action: "buy" | "sell" | "create" | "collectCreatorFee"
  /** several wallets in one transaction (bundles with a lookup table) */
  buyers?: Array<{ publicKey: string; amount: number }>
  lookupTable?: string
  mint?: string
  amount?: number | string
  /** `amount` is in the coin's quote asset ("true") or in tokens ("false"); `denominatedInQuote` is the same switch under the name that reads right on a custom pair */
  denominatedInSol?: "true" | "false"
  denominatedInQuote?: "true" | "false"
  slippage?: number
  /** on the first entry of a bundle this is the Jito tip */
  priorityFee?: number
  pool?: "pump" | "pump-amm" | "auto"
  tokenMetadata?: { name: string; symbol: string; uri: string }
  // ── create only ──
  /** a symbol or mint from GET /api/sol/pairs (USDC, SPYx, …) or any pump.fun coin's mint; default SOL */
  quoteMint?: string
  /** pump.fun's agent trades the coin for 24 h; SOL / USDC quotes only (422 mayhem_quote_not_allowed) */
  mayhemMode?: boolean
  /** your creator fee in basis points, custom pairs only (422 creator_fee_not_allowed otherwise) */
  creatorFeeBps?: number
  /** the creator fee goes to the holders, permanently */
  holderReward?: boolean
  // ── buy only ──
  /** mayhem coins: a buy past the remaining supply takes what is left instead of failing */
  partialFill?: boolean
}
export type BuiltTx = {
  tx: VersionedTransaction; expected: Expected; feeSol: number; action?: string
  /** the coin's quote asset: amounts in `expected.quoteAmount` are in it */
  quote: Quote
  venue?: string
  perBuyer?: Array<{ publicKey: string; tokens: number; sol?: number; quoteAmount?: number }>
  /** on a create: the flags the coin was made with */
  mayhem?: { enabled: boolean }; holderReward?: boolean; creatorFeeBps?: number; depth?: number
}
/** GET /api/sol/token/:mint */
export type TokenInfo = {
  mint: string; name: string | null; symbol: string | null; uri: string | null; tokenProgram: string | null
  venue: "pump" | "pump-amm" | "unknown"
  quote: Quote | null
  mayhem: { enabled: boolean; endsAt?: number; agentTokens?: number }
  holderReward: boolean; creatorFeeBps: number; depth: number; cashback?: boolean
  curve: { complete: boolean; creator: string; bondingProgressPct: number; mayhem: boolean; marketCapQuote: number; priceQuote: number; marketCapSol: number | null; priceSol: number | null } | null
}
export type WalletBalance = { wallet: string; sol: number; token?: { mint: string; balance: number; raw: string; account: string | null; program: string | null } }
export type TokenAccount = { mint: string; balance: number; raw: string; account: string; program: string }
export type Simulation = { ok: boolean; err: unknown; unitsConsumed: number | null; logs: string[] }

export type VanityJobStart = { jobId: string; status: "running"; suffix?: string; prefix?: string; caseSensitive: boolean; expectedAttempts: number; limits?: { maxChars: number; timeoutS: number; pool?: { ready?: Record<string, number> } }; poll: string }
export type VanityJobStatus = {
  jobId: string; status: "running" | "done" | "failed"; pooled: boolean; suffix?: string; prefix?: string; caseSensitive: boolean
  attempts: number; elapsedMs: number; expectedAttempts: number
  /** done, first read only: the keypair, handed out once */
  publicKey?: string; secretKey?: string
  reason?: string; note?: string
}

export type TransferMode = "float" | "fixed" | "private"
export type TransferVenues = { exchange: "on" | "off" | "degraded"; checkedAt: string | null; venues: Record<string, { status: "open" | "closed" | "unknown"; reason?: string; default?: boolean }>; note?: string }
export type DepositTx = { chain: string; encoding: "base64" | "evm"; transaction?: string }
export type TransferCreated = {
  transferId: string; status: string; route: "direct" | "exchange"; mode?: TransferMode; venue?: string; venueRequested?: string; venueHonoured?: boolean
  from: { chain: string; wallet: string }; to: { chain: string; address: string }; amount: number; expected?: { receive: number; fee: number; etaS: number }
  deposit: { chain: string; address: string; amount: number; deadline?: string } | null
  transaction?: DepositTx; poll?: string; warning?: string
}
export type TransferLegError = { error: string; code: string; leg: { to: { address: string }; amount: number } }
export type TransferBatch = { batchId: string; legs: Array<TransferCreated | TransferLegError>; venues: string[] }
export const isLegError = (l: TransferCreated | TransferLegError): l is TransferLegError => "error" in l
export type TransferStatus = {
  transferId: string; status: string; route: "direct" | "exchange"; mode: TransferMode | null; venue: string | null
  from: { chain: string; wallet: string }; to: { chain: string; address: string }; amount: number; expectedReceive: number | null
  depositHash: string | null; payoutHash: string | null; reason?: string; receipt?: string; help?: Record<string, unknown>; createdAt: number; updatedAt: number
}
/** Statuses after which a transfer will not change any more ("sent" is final for direct transfers only). */
export const transferDone = (t: { status: string; route: string }) =>
  ["completed", "failed", "expired", "refunded", "cancelled"].includes(t.status) || (t.route === "direct" && t.status === "sent")

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const b64 = (tx: VersionedTransaction) => Buffer.from(tx.serialize()).toString("base64")

/** The JSON next to a built transaction (`?format=json`): what it does, in the coin's quote asset, and our fee (SOL). */
type BuiltJson = { transaction: string; expected: Expected; feeSol: number; action?: string; quote?: Quote; venue?: string; perBuyer?: BuiltTx["perBuyer"]; mayhem?: { enabled: boolean }; holderReward?: boolean; creatorFeeBps?: number; depth?: number }
const describe = (r: BuiltJson): Omit<BuiltTx, "tx"> => ({
  expected: r.expected, feeSol: r.feeSol, action: r.action, quote: r.quote ?? SOL_QUOTE, venue: r.venue, perBuyer: r.perBuyer,
  ...(r.mayhem ? { mayhem: r.mayhem, holderReward: r.holderReward, creatorFeeBps: r.creatorFeeBps, depth: r.depth } : {}),
})

/** GET /api/sol/pairs is cached 10 minutes per API host (on globalThis, so Next's dev reloads keep it). */
const PAIRS_TTL = 10 * 60_000
const pairsCache = ((globalThis as unknown as { __trenchy_pairs?: Map<string, { at: number; value: Promise<Pairs> }> }).__trenchy_pairs ??= new Map())

export class Trenchy {
  constructor(public readonly url: string, private readonly key: string) {}

  get configured(): boolean {
    return !!this.key
  }

  /** The websocket for live data (one connection, many subscriptions): wss://…/api/sol/data?api-key=… */
  wsUrl(): string {
    return `${this.url.replace(/^http/, "ws")}/api/sol/data?api-key=${encodeURIComponent(this.key)}`
  }

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!this.key) throw new ApiError(`No TrenchyTools API key. Create one at ${this.url}/api/create-api-key?label=pumpfun-starter and paste it in Settings.`, 401, "no_key")
    const headers = new Headers(init.headers)
    headers.set("x-api-key", this.key)
    for (let attempt = 0; ; attempt++) {
      let res: Response
      try {
        res = await fetch(`${this.url}${path}`, { ...init, headers, signal: AbortSignal.timeout(45_000) })
      } catch (e) {
        if (attempt < 2) { await sleep(500 * (attempt + 1)); continue }
        throw new ApiError(`TrenchyTools API unreachable at ${this.url} (${e instanceof Error ? e.message : e})`, 0, "unreachable")
      }
      // 429 carries retry-after: wait as the API says, a few times, rather than failing a launch midway.
      if (res.status === 429 && attempt < 4) { await sleep((Number(res.headers.get("retry-after")) || 1) * 1000); continue }
      const text = await res.text()
      let body: Record<string, unknown> | null = null
      try { body = JSON.parse(text) } catch { /* not JSON */ }
      if (!res.ok) {
        const { error, code, hint, docs, ...extra } = body ?? {}
        throw new ApiError(String(error ?? `TrenchyTools API ${res.status}`), res.status, code as string, hint as string, docs as string, extra)
      }
      return body as T
    }
  }
  private get<T>(path: string) { return this.call<T>(path) }
  private post<T>(path: string, body: unknown) {
    return this.call<T>(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
  }

  // ── account ──────────────────────────────────────────────────────────────

  /** GET /api/me: the key's prefix and 30-day usage. The "Connected" check. */
  me() { return this.get<{ keyPrefix?: string; usage30d?: unknown[] }>("/api/me") }

  // ── building transactions ───────────────────────────────────────────────

  /** POST /api/sol/trade-local (one object): an unsigned buy / sell / create / collectCreatorFee. Sign it, then send(). */
  async tradeLocal(body: TradeBody): Promise<BuiltTx> {
    const r = await this.post<BuiltJson>("/api/sol/trade-local?format=json", body)
    return { ...describe(r), tx: VersionedTransaction.deserialize(Buffer.from(r.transaction, "base64")) }
  }

  /**
   * POST /api/sol/trade-local (an array): up to 5 unsigned transactions for one Jito bundle, in order. The first
   * entry's priorityFee is the Jito tip, paid inside that transaction. Buys of a coin the first entry creates are
   * priced on the curve as it will be at that point in the bundle.
   */
  async bundleLocal(bodies: TradeBody[]): Promise<BuiltTx[]> {
    const r = await this.post<{ transactions: BuiltJson[] }>("/api/sol/trade-local?format=json", bodies)
    return r.transactions.map((t) => ({ ...describe(t), tx: VersionedTransaction.deserialize(bs58.decode(t.transaction)) }))
  }

  /** POST /api/sol/lut: a launch lookup table (5–16 buyers in one bundle). Sign each transaction with `authority`, send them in order. `quoteMint` when the coin will trade in a custom pair. */
  async lutCreate(p: { authority: string; mint: string; wallets: string[]; creator?: string; quoteMint?: string }) {
    const r = await this.post<{ lookupTable: string; addresses: number; rentSol: number; transactions: string[] }>("/api/sol/lut", p)
    return { ...r, txs: r.transactions.map((t) => VersionedTransaction.deserialize(Buffer.from(t, "base64"))) }
  }
  /** GET /api/sol/lut/:address: `ready` once the chain can use the table (one slot after the last extend). */
  lutInfo(address: string) { return this.get<{ lookupTable: string; addresses: string[]; ready: boolean; deactivated: boolean }>(`/api/sol/lut/${address}`) }
  /** POST /api/sol/lut/:address/deactivate | close: the rent comes back on close (~4 minutes after deactivate; 409 cooling_down before). */
  async lutStep(address: string, step: "deactivate" | "close", authority: string) {
    const r = await this.post<{ transaction: string }>(`/api/sol/lut/${address}/${step}`, { authority })
    return VersionedTransaction.deserialize(Buffer.from(r.transaction, "base64"))
  }

  /** GET /api/sol/blockhash: for the plain SOL transfers and account closes this app builds itself. */
  blockhash() { return this.get<{ blockhash: string; lastValidBlockHeight: number }>("/api/sol/blockhash") }

  // ── sending ─────────────────────────────────────────────────────────────

  /** POST /api/sol/send: a signed transaction through the API's node and every Jito region at once. */
  send(tx: VersionedTransaction, opts: { skipPreflight?: boolean } = {}) {
    return this.post<{ signature: string; lanes: string[] }>("/api/sol/send", { transaction: b64(tx), skipPreflight: opts.skipPreflight ?? true })
  }
  /** POST /api/sol/simulate: run a signed transaction without sending it. */
  simulate(tx: VersionedTransaction) { return this.post<Simulation>("/api/sol/simulate", { transaction: b64(tx) }) }
  /** POST /api/sol/bundle: 1–5 signed transactions as one Jito bundle (one of them pays the tip). */
  bundle(txs: VersionedTransaction[]) {
    return this.post<{ bundleId: string; signatures: string[]; region: string }>("/api/sol/bundle", { transactions: txs.map((t) => bs58.encode(t.serialize())) })
  }
  /** GET /api/sol/bundle/:id: pending | landed | failed | invalid. */
  bundleStatus(id: string) { return this.get<{ bundleId: string; status: string; landedSlot?: number | null }>(`/api/sol/bundle/${encodeURIComponent(id)}`) }
  /** GET /api/sol/tx/:signature: confirmation status and error, if any. */
  txStatus(sig: string) { return this.get<{ signature: string; confirmationStatus: string | null; err?: unknown }>(`/api/sol/tx/${encodeURIComponent(sig)}`) }

  /** Poll GET /api/sol/tx/:signature until confirmed (true), failed (throws) or timed out (false). */
  async waitConfirmed(sig: string, timeoutMs = 60_000, onProgress?: (msg: string) => void): Promise<boolean> {
    const start = Date.now()
    let lastNote = 0
    while (Date.now() - start < timeoutMs) {
      const s = await this.txStatus(sig).catch(() => null)
      if (s?.err) throw new Error(`Transaction failed: ${JSON.stringify(s.err)}`)
      if (s?.confirmationStatus === "confirmed" || s?.confirmationStatus === "finalized") return true
      if (onProgress && Date.now() - lastNote > 4000) {
        lastNote = Date.now()
        onProgress(`Still waiting for confirmation (${Math.round((Date.now() - start) / 1000)}s, ${sig.slice(0, 8)}…)`)
      }
      await sleep(1000)
    }
    return false
  }

  /** Sign, send, confirm. */
  async execute(tx: VersionedTransaction, signers: Keypair[], timeoutMs = 60_000): Promise<string> {
    tx.sign(signers)
    const { signature } = await this.send(tx)
    if (!(await this.waitConfirmed(signature, timeoutMs))) throw new Error(`Transaction ${signature.slice(0, 12)}… not confirmed in time; check GET /api/sol/tx before retrying`)
    return signature
  }

  /**
   * A blockhash can be processed for ~150 blocks. A fresh blockhash's lastValidBlockHeight is the current height
   * + 150, so the old one is dead once a fresh one sits more than 150 above it.
   */
  private async blockhashExpired(lastValidBlockHeight: number): Promise<boolean> {
    const fresh = await this.blockhash().catch(() => null)
    return !!fresh && fresh.lastValidBlockHeight - 150 > lastValidBlockHeight
  }

  /**
   * Build and sign a plain transaction ONCE (GET /api/sol/blockhash), then re-send those same signed bytes
   * (POST /api/sol/send) until it confirms or its blockhash dies. Re-sending identical bytes is safe: the chain
   * dedupes by signature, so a transfer that landed but timed out is never paid twice. Only when GET /api/sol/tx
   * still shows nothing after the blockhash can no longer land is it rebuilt with a fresh blockhash.
   */
  async sendInstructions(payer: Keypair, ixs: TransactionInstruction[], extraSigners: Keypair[] = [], confirm = true, rebuilds = 0): Promise<string> {
    let lastSignature = ""
    for (let build = 0; build <= rebuilds; build++) {
      const { blockhash, lastValidBlockHeight } = await this.blockhash()
      const tx = new VersionedTransaction(new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message())
      tx.sign([payer, ...extraSigners])
      const signature = bs58.encode(tx.signatures[0])
      lastSignature = signature

      // First send simulated (skipPreflight false): a transfer from an empty wallet fails here with the reason.
      let sent = false
      for (let attempt = 0; attempt < 3 && !sent; attempt++) {
        try {
          await this.send(tx, { skipPreflight: attempt > 0 })
          sent = true
        } catch (e) {
          if (e instanceof ApiError && e.code === "simulation_failed") throw e
          if (attempt === 2 && !confirm) throw e
          await sleep((attempt + 1) * 800)
        }
      }
      if (!confirm) return signature

      const started = Date.now()
      let lastResend = Date.now()
      let lastExpiryCheck = Date.now()
      let expired = false
      while (Date.now() - started < 180_000) {
        const s = await this.txStatus(signature).catch(() => null)
        if (s?.err) throw new Error(`Transaction failed: ${JSON.stringify(s.err)}`)
        if (s?.confirmationStatus === "confirmed" || s?.confirmationStatus === "finalized") return signature
        if (Date.now() - lastExpiryCheck >= 10_000) {
          lastExpiryCheck = Date.now()
          if (await this.blockhashExpired(lastValidBlockHeight)) { expired = true; break }
        }
        if (Date.now() - lastResend >= 2_000) {
          lastResend = Date.now()
          await this.send(tx, { skipPreflight: true }).catch(() => {})
        }
        await sleep(1000)
      }
      const final = await this.txStatus(signature).catch(() => null)
      if (final?.err) throw new Error(`Transaction failed: ${JSON.stringify(final.err)}`)
      if (final?.confirmationStatus) {
        if (await this.waitConfirmed(signature, 30_000)) return signature
        throw new Error(`Transaction ${signature.slice(0, 12)}… seen by the chain but not confirmed; check GET /api/sol/tx before retrying`)
      }
      if (!expired) throw new Error(`Transaction ${signature.slice(0, 12)}… not confirmed in time (blockhash still valid); check GET /api/sol/tx before retrying`)
    }
    throw new Error(`Transaction ${lastSignature.slice(0, 12)}… expired before it reached the chain`)
  }

  /** SOL from one wallet to another, confirmed (same signed bytes re-sent; rebuilt only once they can no longer land). */
  async transferSol(from: Keypair, to: PublicKey, solAmount: number, opts: { lamports?: number; confirm?: boolean } = {}): Promise<string> {
    const lamports = opts.lamports ?? Math.round(solAmount * LAMPORTS_PER_SOL)
    try {
      return await this.sendInstructions(from, [SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: to, lamports })], [], opts.confirm ?? true, 2)
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e)
      if (/AccountNotFound|insufficient (funds|lamports)|InsufficientFunds/i.test(why)) {
        throw new Error(`Transfer of ${(lamports / LAMPORTS_PER_SOL).toFixed(6)} SOL failed: ${from.publicKey.toBase58().slice(0, 8)}… does not hold enough SOL.`)
      }
      throw new Error(`Transfer of ${(lamports / LAMPORTS_PER_SOL).toFixed(6)} SOL failed: ${why}`)
    }
  }

  // ── reading ─────────────────────────────────────────────────────────────

  /** GET /api/sol/balances?wallets=…[&mint=…]: SOL (and one coin) for up to 100 wallets per call. */
  async balances(wallets: string[], mint?: string): Promise<WalletBalance[]> {
    const out: WalletBalance[] = []
    for (let i = 0; i < wallets.length; i += 100) {
      const chunk = wallets.slice(i, i + 100)
      const r = await this.get<{ wallets: WalletBalance[] }>(`/api/sol/balances?wallets=${chunk.join(",")}${mint ? `&mint=${mint}` : ""}`)
      out.push(...r.wallets)
    }
    return out
  }
  async solBalance(wallet: string): Promise<number> {
    return (await this.balances([wallet]))[0]?.sol ?? 0
  }
  /** GET /api/sol/balances?wallet=…&includeEmpty=true: every token account of one wallet (empty ones too, to close them). */
  async tokenAccounts(wallet: string, includeEmpty = false): Promise<TokenAccount[]> {
    const r = await this.get<{ tokens: TokenAccount[] }>(`/api/sol/balances?wallet=${wallet}${includeEmpty ? "&includeEmpty=true" : ""}`)
    return r.tokens
  }
  /** GET /api/sol/creator-fees?wallet=…: unclaimed pump.fun creator fees of a dev wallet. */
  creatorFees(wallet: string) { return this.get<{ wallet: string; lamports: string; sol: number }>(`/api/sol/creator-fees?wallet=${wallet}`) }

  /** GET /api/sol/token/:mint: venue, quote asset, Mayhem / holder-reward / creator-fee flags, curve state. */
  token(mint: string) { return this.get<TokenInfo>(`/api/sol/token/${encodeURIComponent(mint)}`) }

  // ── custom pairs ────────────────────────────────────────────────────────

  /**
   * GET /api/sol/pairs: the quote assets a coin can be launched in right now (SOL, USDC, xStocks, WBTC, PUMP, …), with
   * symbol, decimals and a `kind` to group a UI by. Cached 10 minutes; `force` re-reads. Pump coins are not listed:
   * any coin's mint works as `quoteMint` (resolvePair reads its symbol from GET /api/sol/token).
   */
  pairs(force = false): Promise<Pairs> {
    const hit = pairsCache.get(this.url)
    if (!force && hit && Date.now() - hit.at < PAIRS_TTL) return hit.value
    const value = this.get<Pairs>("/api/sol/pairs").then((r) => ({ pairs: r.pairs.map((p) => ({ ...p, name: p.name ?? null })), checkedAt: r.checkedAt }))
    pairsCache.set(this.url, { at: Date.now(), value })
    value.catch(() => pairsCache.delete(this.url))
    return value
  }

  /**
   * A `quoteMint` as the Launch form sends it (a symbol like "USDC" / "SPYx", a mint, or empty for SOL) → the pair.
   * Symbols match case-insensitively against GET /api/sol/pairs; an unlisted mint is read as a pump coin via
   * GET /api/sol/token/:mint (its own quote tells nothing about *it*, so symbol + decimals come from the metadata).
   */
  async resolvePair(quoteMint: string | undefined): Promise<Pair> {
    const key = (quoteMint ?? "").trim()
    const { pairs } = await this.pairs()
    const sol = pairs.find((p) => p.mint === SOL_MINT) ?? SOL_PAIR
    if (!key || key.toUpperCase() === "SOL") return sol
    const hit = pairs.find((p) => p.mint === key) ?? pairs.find((p) => p.symbol.toLowerCase() === key.toLowerCase())
    if (hit) return hit
    if (key.length < 32) throw new ApiError(`${key} is not a symbol from GET /api/sol/pairs; pass a mint address for a pump coin`, 400, "unsupported_quote")
    const t = await this.token(key)
    return { mint: t.mint, symbol: t.symbol ?? key.slice(0, 4), name: t.name, decimals: 6, tokenProgram: t.tokenProgram ?? "", source: "pumpCoin", kind: "pump", initialVirtualQuoteReserves: "", feeSchedule: "exotic" }
  }

  // ── vanity mints (ground on the API's workers) ──────────────────────────

  /** POST /api/sol/vanity: start a job (suffix + prefix ≤ 4 characters). Common suffixes come from a warm pool and are done at once. */
  vanityStart(p: { suffix?: string; prefix?: string; caseSensitive?: boolean }) { return this.post<VanityJobStart>("/api/sol/vanity", p) }
  /** GET /api/sol/vanity/:jobId: running | done (keypair, handed out exactly once: save it at once) | failed. */
  vanityJob(jobId: string) { return this.get<VanityJobStatus>(`/api/sol/vanity/${encodeURIComponent(jobId)}`) }

  // ── transfers (wallet → wallet, direct or through an exchange hop) ──────

  /** GET /api/transfer/venues: which exchange venues are open right now. */
  transferVenues() { return this.get<TransferVenues>("/api/transfer/venues") }
  /** POST /api/transfer/batch: one source → many destinations (or many → one); one order + unsigned deposit per leg. */
  createTransferBatch(body: { from: { chain: "sol"; wallet: string }; to: Array<{ chain: "sol"; address: string; amount: number }>; mode?: TransferMode; venue?: string }) {
    return this.post<TransferBatch>("/api/transfer/batch", body)
  }
  /** GET /api/transfer/:id: awaiting_deposit → exchanging → completed (payoutHash), or a terminal failure with `help`. */
  transferStatus(id: string) { return this.get<TransferStatus>(`/api/transfer/${encodeURIComponent(id)}`) }
  /** POST /api/transfer/:id/sent: record the signature of the deposit you sent. */
  transferSent(id: string, hash: string) { return this.post<{ ok: boolean }>(`/api/transfer/${encodeURIComponent(id)}/sent`, { hash }) }

  /** The Solana deposit transaction of a transfer leg, deserialized. */
  static depositTx(leg: { transaction?: DepositTx | null }): VersionedTransaction {
    if (!leg.transaction || leg.transaction.encoding !== "base64" || !leg.transaction.transaction) throw new Error("transfer leg carries no Solana deposit transaction")
    return VersionedTransaction.deserialize(Buffer.from(leg.transaction.transaction, "base64"))
  }

  /** The deposit transaction the API built must be exactly one SOL transfer, from our wallet, to the deposit address, for the agreed amount. */
  static checkDeposit(tx: VersionedTransaction, payer: PublicKey, depositAddress: string, expectedLamports: number): void {
    const msg = tx.message
    const keys = msg.staticAccountKeys
    if (!keys[0]?.equals(payer)) throw new Error("deposit transaction is not paid by our wallet")
    if (msg.compiledInstructions.length !== 1) throw new Error(`deposit transaction has ${msg.compiledInstructions.length} instructions, expected 1`)
    const ix = msg.compiledInstructions[0]
    if (!keys[ix.programIdIndex]?.equals(SystemProgram.programId)) throw new Error("deposit transaction is not a system transfer")
    const data = Buffer.from(ix.data)
    if (data.length !== 12 || data.readUInt32LE(0) !== 2) throw new Error("deposit transaction is not a SOL transfer")
    const lamports = Number(data.readBigUInt64LE(4))
    if (lamports !== expectedLamports) throw new Error(`deposit transaction moves ${lamports / LAMPORTS_PER_SOL} SOL, expected ${expectedLamports / LAMPORTS_PER_SOL}`)
    if (!keys[ix.accountKeyIndexes[0]]?.equals(payer)) throw new Error("deposit transaction does not send from our wallet")
    if (keys[ix.accountKeyIndexes[1]]?.toBase58() !== depositAddress) throw new Error("deposit transaction does not send to this transfer's deposit address")
  }

  // ── metadata ────────────────────────────────────────────────────────────

  /** POST /api/ipfs (multipart): pin the image + metadata, get the `metadataUri` for the create. Pass the browser's FormData straight through. */
  async uploadMetadata(form: FormData): Promise<{ metadataUri: string; metadata?: Record<string, unknown> }> {
    return this.call("/api/ipfs", { method: "POST", body: form })
  }
}

/** The client with the current settings. Cheap: build one per request. */
export function trenchy(): Trenchy {
  const { apiUrl, apiKey } = effectiveSettings()
  return new Trenchy(apiUrl, apiKey)
}
