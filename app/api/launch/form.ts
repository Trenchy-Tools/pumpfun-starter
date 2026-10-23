import { num } from "@/lib/http"
import type { Buyer, LaunchForm } from "@/lib/launch"
import { effectiveSettings } from "@/lib/settings"

/** The Launch page's JSON → a LaunchForm with defaults and bounds. */
export function readForm(b: Record<string, unknown>): LaunchForm {
  const s = (v: unknown) => (typeof v === "string" ? v.trim() : "")
  const o = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {})
  const count = (v: unknown, max: number) => Math.max(0, Math.min(max, Math.floor(num(v, 0))))
  /** `wallets: [{ publicKey, amount }]`: the explicit buyers of a group (bad entries dropped; at most `max`). */
  const buyers = (v: unknown, max: number): Buyer[] | undefined => {
    if (!Array.isArray(v)) return undefined
    const out: Buyer[] = []
    for (const x of v) {
      const e = o(x)
      const publicKey = s(e.publicKey)
      const amount = Math.max(0, num(e.amount, 0))
      if (publicKey.length >= 32 && !out.some((b) => b.publicKey === publicKey)) out.push({ publicKey, amount })
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
    slippage: Math.max(1, Math.min(50, num(b.slippage, effectiveSettings().slippage))),
  }
}
