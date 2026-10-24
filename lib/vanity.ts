/**
 * Vanity mint pool in local mode: `_app/pumpfun-starter/vanity-pool.json` in the wallet folder. The pool and the job
 * runner are lib/core/vanity.ts; this file only says where the pool is kept.
 *
 * Grinding happens on the API: POST /api/sol/vanity starts a job, GET /api/sol/vanity/:jobId reports progress and
 * hands the keypair out exactly once when done. Every key the API returns is written to the pool file the moment it
 * arrives. Mint keypairs hold no funds and are not wallets: they live here, not among the wallet files.
 */
import { createVanity, idleJob, type JobView, type PoolEntry } from "./core/vanity"
import { VANITY_POOL_FILE, readJson, serverState, writeJson } from "./paths"
import { trenchy } from "./settings"

export type { JobView, PoolEntry, PoolView } from "./core/vanity"

const state = serverState("vanity", () => ({ job: idleJob() as JobView }))

const v = createVanity({
  readPool: () => readJson<PoolEntry[]>(VANITY_POOL_FILE, []),
  writePool: (pool) => writeJson(VANITY_POOL_FILE, pool),
  api: trenchy,
  state,
  where: VANITY_POOL_FILE,
})

export const { pool, jobStatus, randomForLaunch, takeForLaunch, startJob } = v
