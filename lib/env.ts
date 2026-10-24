/**
 * Local mode's Env (lib/core/env.ts): the wallet folder, the vanity pool file, launches.json and the settings, with the
 * API client built from them. The shared flows in lib/core/* run on it; the browser engine builds its own Env from
 * localStorage (lib/browser/engine.ts).
 */
import type { Env } from "./core/launch"
import type { LaunchRecord } from "./core/launch"
import { LAUNCHES_FILE, readJson, writeJson } from "./paths"
import { effectiveSettings, trenchy } from "./settings"
import * as vanity from "./vanity"
import { walletStore } from "./wallets"

/** launches.json in _app/pumpfun-starter/, oldest first. */
export const readLaunches = (): LaunchRecord[] => readJson<LaunchRecord[]>(LAUNCHES_FILE, [])
export function saveLaunch(rec: LaunchRecord): void {
  const all = readLaunches().filter((l) => l.id !== rec.id)
  writeJson(LAUNCHES_FILE, [...all, rec])
}

/** The Env with the current settings. Cheap: build one per request. */
export function serverEnv(): Env {
  const s = effectiveSettings()
  return {
    api: trenchy(),
    wallets: walletStore,
    mints: { takeForLaunch: vanity.takeForLaunch, randomForLaunch: vanity.randomForLaunch },
    launches: { list: readLaunches, save: saveLaunch },
    jitoTipLamports: s.jitoTipLamports,
    slippage: s.slippage,
  }
}
