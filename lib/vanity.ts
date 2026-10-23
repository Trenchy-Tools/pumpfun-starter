/**
 * Vanity mint pool: `_app/pumpfun-starter/vanity-pool.json` in the wallet folder.
 *
 * Grinding happens on the API: POST /api/sol/vanity starts a job, GET /api/sol/vanity/:jobId reports progress and
 * hands the keypair out exactly once when done. Every key the API returns is written to the pool file the moment it
 * arrives. Mint keypairs hold no funds and are not wallets: they live here, not among the wallet files.
 */
import { Keypair } from "@solana/web3.js"
import bs58 from "bs58"
import { VANITY_POOL_FILE, readJson, serverState, writeJson } from "./paths"
import { ApiError, trenchy, type VanityJobStatus } from "./trenchy"

export type PoolEntry = {
  publicKey: string
  secretKey: string // base58
  suffix: string
  prefix: string
  caseSensitive: boolean
  status: "available" | "used"
  createdAt: string
  usedAt?: string
  usedFor?: string // launch id
  source: "api-pool" | "api-job" | "random"
}
export type PoolView = Omit<PoolEntry, "secretKey">

/** The job running (or last run) on the API, as the Vanity page shows it. */
export type JobView = {
  jobId: string | null
  status: "idle" | "running" | "done" | "failed"
  suffix: string
  prefix: string
  caseSensitive: boolean
  attempts: number
  expectedAttempts: number
  elapsedMs: number
  /** attempts per second */
  rate: number
  pooled: boolean
  found: string | null
  error: string | null
  poolReady: Record<string, number>
}

const state = serverState("vanity", () => ({
  job: { jobId: null, status: "idle", suffix: "", prefix: "", caseSensitive: true, attempts: 0, expectedAttempts: 0, elapsedMs: 0, rate: 0, pooled: false, found: null, error: null, poolReady: {} } as JobView,
}))

const readPool = (): PoolEntry[] => readJson<PoolEntry[]>(VANITY_POOL_FILE, [])
const writePool = (pool: PoolEntry[]) => writeJson(VANITY_POOL_FILE, pool)
const view = ({ secretKey: _s, ...rest }: PoolEntry): PoolView => { void _s; return rest }

export const pool = (): PoolView[] => readPool().map(view).reverse()
export const jobStatus = (): JobView => state.job

/** Save a keypair to the pool (before anything else happens with it). The secret must reproduce the public key. */
function store(kp: Keypair, meta: Pick<PoolEntry, "suffix" | "prefix" | "caseSensitive" | "source">, status: PoolEntry["status"] = "available", usedFor?: string): PoolEntry {
  const entry: PoolEntry = { publicKey: kp.publicKey.toBase58(), secretKey: bs58.encode(kp.secretKey), ...meta, status, createdAt: new Date().toISOString(), ...(usedFor ? { usedAt: new Date().toISOString(), usedFor } : {}) }
  const all = readPool()
  if (!all.some((e) => e.publicKey === entry.publicKey)) writePool([...all, entry])
  return entry
}

/** A random mint keypair for a launch: saved to the pool as used, so the launch can be traced back to its key. */
export function randomForLaunch(launchId: string): Keypair {
  const kp = Keypair.generate()
  store(kp, { suffix: "", prefix: "", caseSensitive: true, source: "random" }, "used", launchId)
  return kp
}

/** Take a pooled key for a launch (a specific one, or the next available `…pump`, else any) and mark it used. */
export function takeForLaunch(launchId: string, publicKey?: string): Keypair {
  const all = readPool()
  const entry = publicKey ? all.find((e) => e.publicKey === publicKey) : all.find((e) => e.status === "available" && e.suffix === "pump") ?? all.find((e) => e.status === "available")
  if (!entry) throw new Error(publicKey ? `Vanity key ${publicKey.slice(0, 8)}… is not in the pool` : "No vanity key available: grind one on the Vanity page first")
  if (entry.status === "used") throw new Error(`Vanity key ${entry.publicKey.slice(0, 8)}… was already used`)
  const kp = Keypair.fromSecretKey(bs58.decode(entry.secretKey))
  entry.status = "used"
  entry.usedAt = new Date().toISOString()
  entry.usedFor = launchId
  writePool(all)
  return kp
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const apply = (job: VanityJobStatus) => {
  const j = state.job
  j.jobId = job.jobId
  j.attempts = job.attempts
  j.expectedAttempts = job.expectedAttempts
  j.elapsedMs = job.elapsedMs
  j.rate = job.elapsedMs > 0 ? Math.round(job.attempts / (job.elapsedMs / 1000)) : 0
  j.pooled = job.pooled
}

/** A finished job: verify the key and save it. */
function finish(job: VanityJobStatus): void {
  const j = state.job
  if (job.status === "failed") { j.status = "failed"; j.error = job.reason ?? "the API job failed"; return }
  if (!job.publicKey || !job.secretKey) { j.status = "failed"; j.error = job.note ?? "the job finished but its key was already collected"; return }
  const kp = Keypair.fromSecretKey(bs58.decode(job.secretKey))
  if (kp.publicKey.toBase58() !== job.publicKey) { j.status = "failed"; j.error = "the keypair from the API does not match its public key"; return }
  store(kp, { suffix: job.suffix ?? "", prefix: job.prefix ?? "", caseSensitive: job.caseSensitive, source: job.pooled ? "api-pool" : "api-job" })
  j.status = "done"
  j.found = job.publicKey
  console.log(`[vanity] ${job.publicKey} saved → ${VANITY_POOL_FILE} (${job.pooled ? "API warm pool" : `${job.attempts.toLocaleString()} attempts`})`)
}

/**
 * Start one job (POST /api/sol/vanity) and follow it in the background (GET /api/sol/vanity/:jobId every 2.5 s).
 * Returns once the job is accepted, so a refusal (vanity_too_long, vanity_busy, no key) comes back at once.
 */
export async function startJob(p: { suffix?: string; prefix?: string; caseSensitive?: boolean }): Promise<JobView> {
  if (state.job.status === "running") throw new ApiError("A vanity job is already running; wait for it to finish", 409, "vanity_busy")
  const api = trenchy()
  const suffix = (p.suffix ?? "").trim()
  const prefix = (p.prefix ?? "").trim()
  if (!suffix && !prefix) throw new Error("Give a suffix or a prefix")
  state.job = { ...state.job, jobId: null, status: "running", suffix, prefix, caseSensitive: p.caseSensitive !== false, attempts: 0, expectedAttempts: 0, elapsedMs: 0, rate: 0, pooled: false, found: null, error: null }
  const start = await api.vanityStart({ suffix: suffix || undefined, prefix: prefix || undefined, caseSensitive: p.caseSensitive !== false })
  state.job.jobId = start.jobId
  state.job.expectedAttempts = start.expectedAttempts
  state.job.poolReady = start.limits?.pool?.ready ?? state.job.poolReady
  // One read straight away: a pooled key is already done and is handed out here.
  const first = await api.vanityJob(start.jobId)
  apply(first)
  if (first.status !== "running") finish(first)
  else void follow(start.jobId)
  return state.job
}

async function follow(jobId: string): Promise<void> {
  const api = trenchy()
  for (;;) {
    await sleep(2500)
    try {
      const job = await api.vanityJob(jobId)
      apply(job)
      if (job.status !== "running") { finish(job); return }
    } catch (e) {
      // A network blip is retried; a definitive refusal ends the job.
      if (e instanceof ApiError && e.status !== 0 && e.status !== 429) { state.job.status = "failed"; state.job.error = e.message; return }
    }
  }
}
