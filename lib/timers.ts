/**
 * Timed sells: "at +N minutes sell X % from these wallets". Rules live in server memory (they survive page reloads,
 * not a server restart) and fire through the same sell path as the Trading page (lib/trading.ts sellAll).
 */
import { serverState } from "./paths"
import { sellAll, type SellAllResult } from "./trading"

export type TimerRule = {
  id: string
  mint: string
  publicKeys: string[]
  percent: number
  createdAt: number
  dueAt: number
  status: "pending" | "running" | "done" | "cancelled" | "error"
  result?: SellAllResult
  error?: string
}

const state = serverState("timers", () => ({ rules: new Map<string, TimerRule & { handle?: ReturnType<typeof setTimeout> }>() }))

const view = ({ handle: _h, ...rule }: TimerRule & { handle?: unknown }): TimerRule => { void _h; return rule }

export const listTimers = (mint?: string): TimerRule[] =>
  [...state.rules.values()].filter((r) => !mint || r.mint === mint).map(view).sort((a, b) => a.dueAt - b.dueAt)

/** Schedule a rule; `minutes` from now. */
export function addTimer(p: { mint: string; publicKeys: string[]; percent: number; minutes: number }): TimerRule {
  if (!p.publicKeys.length) throw new Error("Pick at least one wallet")
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  const rule: TimerRule & { handle?: ReturnType<typeof setTimeout> } = {
    id, mint: p.mint, publicKeys: p.publicKeys, percent: Math.max(1, Math.min(100, Math.round(p.percent))),
    createdAt: Date.now(), dueAt: Date.now() + Math.max(0, p.minutes) * 60_000, status: "pending",
  }
  rule.handle = setTimeout(() => void fire(id), rule.dueAt - Date.now())
  state.rules.set(id, rule)
  return view(rule)
}

async function fire(id: string): Promise<void> {
  const rule = state.rules.get(id)
  if (!rule || rule.status !== "pending") return
  rule.status = "running"
  try {
    rule.result = await sellAll(rule.publicKeys, rule.mint, rule.percent)
    rule.status = "done"
  } catch (e) {
    rule.status = "error"
    rule.error = e instanceof Error ? e.message : String(e)
  }
}

export function cancelTimer(id: string): TimerRule | null {
  const rule = state.rules.get(id)
  if (!rule) return null
  if (rule.status === "pending") {
    clearTimeout(rule.handle)
    rule.status = "cancelled"
  }
  return view(rule)
}

/** Forget finished rules (done / cancelled / error). */
export function clearFinished(): number {
  let n = 0
  for (const [id, r] of state.rules) if (r.status !== "pending" && r.status !== "running") { state.rules.delete(id); n++ }
  return n
}
