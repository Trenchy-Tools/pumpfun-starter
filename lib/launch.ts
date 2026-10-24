/**
 * A pump.fun launch in local mode: the executor in lib/core/launch.ts (read it top to bottom: plan, wallets, mint,
 * funding, lookup table, bundle, snipers, holders, record) run by this server on the wallet folder (lib/env.ts).
 *
 * The record goes to launches.json in _app/pumpfun-starter/; every stage is kept in server memory and streamed as
 * server-sent events from GET /api/launch/:id/events.
 */
import * as core from "./core/launch"
import { readLaunches, serverEnv } from "./env"
import { serverState } from "./paths"
import type { LaunchEvent, LaunchForm, LaunchRecord } from "./core/launch"

export { groupSize, planProblems, MAX_BUNDLE_WALLETS, BUYERS_PER_TX, PLAIN_BUNDLE_WALLETS } from "./core/launch"
export type { Buyer, BuyerGroup, LaunchEvent, LaunchForm, LaunchRecord, Picked, Plan, PlanRow, Refusal, Shortfall, SimulateResult } from "./core/launch"
export { readLaunches }

// ── event log ───────────────────────────────────────────────────────────────

const log = serverState("launchLog", () => ({ events: new Map<string, LaunchEvent[]>(), listeners: new Map<string, Set<(e: LaunchEvent) => void>>() }))

export const eventsOf = (id: string): LaunchEvent[] => log.events.get(id) ?? []
export function subscribe(id: string, cb: (e: LaunchEvent) => void): () => void {
  if (!log.listeners.has(id)) log.listeners.set(id, new Set())
  log.listeners.get(id)!.add(cb)
  return () => log.listeners.get(id)?.delete(cb)
}
function emitter(id: string): core.Emit {
  return (stage, message, extra = {}) => {
    const e: LaunchEvent = { at: Date.now(), stage, message, ...extra }
    if (!log.events.has(id)) log.events.set(id, [])
    log.events.get(id)!.push(e)
    for (const cb of log.listeners.get(id) ?? []) cb(e)
    console.log(`[launch ${id.slice(0, 6)}] ${stage}: ${message}`)
  }
}

// ── the flows, on the folder ────────────────────────────────────────────────

export const devWallet = (form: LaunchForm) => core.devWallet(serverEnv(), form)
export const fundingPlan = (form: LaunchForm) => core.fundingPlan(serverEnv(), form)
export const fundPlan = (form: LaunchForm, note?: (msg: string) => void) => core.fundPlan(serverEnv(), form, note)
export const simulateLaunch = (form: LaunchForm) => core.simulateLaunch(serverEnv(), form)

/** Start a launch in the background; returns the record (follow it on GET /api/launch/:id/events). */
export function startLaunch(form: LaunchForm): LaunchRecord {
  const env = serverEnv()
  const rec = core.prepareLaunch(env, form)
  void core.runLaunch(env, rec, form, emitter(rec.id))
  return rec
}
