/**
 * Request-body parsing shared by the server routes (local mode) and the browser engine (demo mode): the same JSON in,
 * the same bounds and defaults. No node imports.
 */
import type { Buyer, LaunchForm } from "./launch"

/** A number from a form field, or the default. */
export const num = (v: unknown, d: number): number => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN
  return Number.isFinite(n) ? n : d
}

export const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x) : [])

/** The Launch page's JSON → a LaunchForm with defaults and bounds. `defaultSlippage` is the settings' slippage. */
export function readForm(b: Record<string, unknown>, defaultSlippage: number): LaunchForm {
  const s = (v: unknown) => (typeof v === "string" ? v.trim() : "")
  const o = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {})
  const count = (v: unknown, max: number) => Math.max(0, Math.min(max, Math.floor(num(v, 0))))
  /**
   * `wallets: [{ publicKey, amount }]`: the explicit buyers of a group (at most `max`). `publicKey` null or "" means
   * "a new wallet": the executor creates (and backs up) one for that row at launch. Bad or repeated keys are dropped.
   */
  const buyers = (v: unknown, max: number): Buyer[] | undefined => {
    if (!Array.isArray(v)) return undefined
    const out: Buyer[] = []
    for (const x of v) {
      const e = o(x)
      const publicKey = s(e.publicKey)
      const amount = Math.max(0, num(e.amount, 0))
      if (!publicKey) out.push({ publicKey: null, amount })
      else if (publicKey.length >= 32 && !out.some((b) => b.publicKey === publicKey)) out.push({ publicKey, amount })
    }
    return out.slice(0, max)
  }
  const bundle = o(b.bundle), snipers = o(b.snipers), holders = o(b.holders), mint = o(b.mint)
  return {
    name: s(b.name).slice(0, 32), symbol: s(b.symbol).slice(0, 10), description: s(b.description), metadataUri: s(b.metadataUri),
    twitter: s(b.twitter), telegram: s(b.telegram), website: s(b.website),
    mint: { mode: mint.mode === "vanity" ? "vanity" : "random", publicKey: s(mint.publicKey) || undefined },
    // the pair and the create options (quoteMint: "" / "SOL" = a SOL coin; creatorFeeBps 0 = pump.fun's schedule)
    quoteMint: s(b.quoteMint).slice(0, 64),
    mayhemMode: b.mayhemMode === true,
    creatorFeeBps: Math.max(0, Math.min(10_000, Math.round(num(b.creatorFeeBps, 0)))),
    holderReward: b.holderReward === true,
    devWallet: s(b.devWallet) || undefined,
    devBuySol: Math.max(0, num(b.devBuySol, 0)),
    bundle: { count: count(bundle.count, 16), solEach: Math.max(0, num(bundle.solEach, 0)), wallets: buyers(bundle.wallets, 16) },
    snipers: { count: count(snipers.count, 50), solEach: Math.max(0, num(snipers.solEach, 0)), wallets: buyers(snipers.wallets, 50), gapMs: Math.max(0, num(snipers.gapMs, 400)) },
    holders: { count: count(holders.count, 100), solEach: Math.max(0, num(holders.solEach, 0)), wallets: buyers(holders.wallets, 100), delayS: Math.max(0, num(holders.delayS, 0)), windowS: Math.max(1, num(holders.windowS, 120)) },
    fundFirst: b.fundFirst === true,
    useJito: b.useJito !== false,
    slippage: Math.max(1, Math.min(50, num(b.slippage, defaultSlippage))),
  }
}
