"use client"

/**
 * The browser engine of demo mode: this app's /api/* routes, answered inside the visitor's tab.
 *
 * Same paths, same request bodies, same JSON answers and error shapes as the route handlers in app/api/** (local
 * mode), so the pages run unchanged on top of it (lib/browser/demo.ts appFetch / appEvents is the switch). The flows
 * are the shared ones in lib/core/* (launch executor, trading, funding, vanity, timers, form parsing); only the
 * storage differs:
 *
 *   wallets           lib/browser/keystore.ts (localStorage, backup rule: not usable until downloaded)
 *   API key           lib/browser/api-key.ts (one per visitor, created on first visit)
 *   launches + log    localStorage <prefix>.launches / <prefix>.launchLog.<id>; a launch runs in this tab
 *   timed sells       localStorage <prefix>.timers; fired by any open tab of the app, resumed on reload
 *   vanity pool       localStorage <prefix>.vanityPool (mint keys, not wallets)
 *   settings          localStorage <prefix>.settings (tip, slippage)
 *
 * Every API call goes from the browser straight to https://api.trenchy.tools with the visitor's key (lib/trenchy.ts,
 * the same client class the server uses). The live-trades websocket too. Nothing touches the app's own server.
 *
 * Loaded only in demo mode (a dynamic import in demo.ts).
 */
import * as launch from "../core/launch"
import * as trading from "../core/trading"
import { closeEmpty, fundDirect, fundViaExchange, gather } from "../core/funding"
import { DEFAULT_SLIPPAGE, DEFAULT_TIP_LAMPORTS, type WalletStore } from "../core/env"
import { RouteError, errorBody } from "../core/errors"
import { num, readForm, strings } from "../core/form"
import { fireRule, isFinished, newTimerRule, type TimerRule } from "../core/timers"
import { createVanity, idleJob, type PoolEntry } from "../core/vanity"
import { APP_NAME, CHAIN, cleanLabel, isRole, newLabel, stampAt, type Role, type WalletInfo } from "../core/wallet-record"
import { ApiError, Trenchy, type TransferMode } from "../trenchy"
import { ensureApiKey, keyError, maskKey, readApiKey, replaceApiKey, setApiKey, type KeyOptions } from "./api-key"
import { DEMO_API_URL, DEMO_KEY_LABEL, KEYS_HOME, STORE_PREFIX, type EventStream } from "./demo"
import { createKeystore, type KeyView } from "./keystore"
import { generateKey, parseSecret, signerOf } from "./signer-sol"

const P = STORE_PREFIX
const KEY_OPTS: KeyOptions = { storageKey: `${P}.apiKey`, apiUrl: DEMO_API_URL, label: DEMO_KEY_LABEL }

// ── small storage helpers (settings, records) ───────────────────────────────

function load<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}
function save(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch (e) {
    throw new Error(`This browser refused to store the data (${e instanceof Error ? e.message : e})`)
  }
}

type BrowserSettings = { jitoTipLamports?: number; slippage?: number }
const settings = () => {
  const s = load<BrowserSettings>(`${P}.settings`, {})
  const ok = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0
  return { jitoTipLamports: ok(s.jitoTipLamports) ? s.jitoTipLamports! : DEFAULT_TIP_LAMPORTS, slippage: ok(s.slippage) ? s.slippage! : DEFAULT_SLIPPAGE, overrides: { apiUrl: false, jitoTipLamports: ok(s.jitoTipLamports), slippage: ok(s.slippage) } }
}

/** The API client with the visitor's key (the same class the server uses with its key). */
const api = () => new Trenchy(DEMO_API_URL, readApiKey(KEY_OPTS) ?? "")

// ── wallets: the keystore as the store the shared flows use ─────────────────

const ks = createKeystore({ prefix: P, chain: CHAIN, app: APP_NAME, fileTag: "pumpfun" })

const info = (w: KeyView): WalletInfo & { backedUp: boolean } => ({ publicKey: w.publicKey, chain: w.chain, role: isRole(w.role) ? w.role : "trader", label: w.label, createdAt: w.createdAt, app: w.app, file: KEYS_HOME, backedUp: w.backedUp })

function createWallets(count: number, role: Role = "trader", label?: string) {
  const n = Math.min(Math.max(Math.floor(count) || 1, 1), 100)
  const start = ks.seen() + 1
  const out: Array<WalletInfo & { backedUp: boolean; path: string }> = []
  for (let i = 0; i < n; i++) {
    const k = generateKey()
    const { wallet } = ks.add({ ...k, chain: CHAIN, role, label: newLabel(label, n, i, start), createdAt: stampAt(i), app: APP_NAME })
    out.push({ ...info(wallet), path: KEYS_HOME })
  }
  return out
}

const walletStore: WalletStore = {
  place: "browser",
  list: (role) => ks.list().map(info).filter((w) => !role || w.role === role),
  get: (pk) => { const w = ks.get(pk); return w ? info(w) : null },
  main: () => { const pk = ks.main(); const w = pk ? ks.get(pk) : null; return w ? info(w) : null },
  assertBackedUp: (pk) => ks.assertBackedUp(pk),
  keypairOf: (pk) => signerOf(pk, ks.signerSecret(pk)),
  create: (count, role, label) => createWallets(count, role, label),
  backupNote: (w) => `is backed up (key downloaded; kept in ${KEYS_HOME})`,
}

// ── vanity pool, launches ───────────────────────────────────────────────────

const vanity = createVanity({
  readPool: () => load<PoolEntry[]>(`${P}.vanityPool`, []),
  writePool: (pool) => save(`${P}.vanityPool`, pool),
  api,
  state: { job: idleJob() },
  where: `${KEYS_HOME} (localStorage)`,
})

const readLaunches = () => load<launch.LaunchRecord[]>(`${P}.launches`, [])
function saveLaunch(rec: launch.LaunchRecord): void {
  save(`${P}.launches`, [...readLaunches().filter((l) => l.id !== rec.id), rec])
}

/** The Env the shared flows run on, with the current key and settings. Cheap: build one per request. */
function env(): launch.Env {
  const s = settings()
  return { api: api(), wallets: walletStore, mints: { takeForLaunch: vanity.takeForLaunch, randomForLaunch: vanity.randomForLaunch }, launches: { list: readLaunches, save: saveLaunch }, jitoTipLamports: s.jitoTipLamports, slippage: s.slippage }
}

// ── launch log: in memory, mirrored to localStorage so a reload still shows it ─────────────────────────────────────

const log = { events: new Map<string, launch.LaunchEvent[]>(), listeners: new Map<string, Set<(e: launch.LaunchEvent) => void>>() }
const eventsOf = (id: string): launch.LaunchEvent[] => log.events.get(id) ?? load<launch.LaunchEvent[]>(`${P}.launchLog.${id}`, [])
function emitter(id: string): launch.Emit {
  return (stage, message, extra = {}) => {
    const e: launch.LaunchEvent = { at: Date.now(), stage, message, ...extra }
    const list = [...eventsOf(id), e]
    log.events.set(id, list)
    try { save(`${P}.launchLog.${id}`, list.slice(-300)) } catch { /* the log is a convenience */ }
    for (const cb of log.listeners.get(id) ?? []) cb(e)
  }
}
function subscribeLaunch(id: string, cb: (e: launch.LaunchEvent) => void): () => void {
  if (!log.listeners.has(id)) log.listeners.set(id, new Set())
  log.listeners.get(id)!.add(cb)
  return () => log.listeners.get(id)?.delete(cb)
}

const locks = () => (typeof navigator !== "undefined" && "locks" in navigator ? navigator.locks : null)
const launchLock = (id: string) => `${P}.launch.${id}`

/** Run a prepared launch in this tab, holding a lock so another tab can tell it is still running. */
function runInTab(rec: launch.LaunchRecord, form: launch.LaunchForm): void {
  const go = () => launch.runLaunch(env(), rec, form, emitter(rec.id))
  const l = locks()
  if (l) void l.request(launchLock(rec.id), go)
  else void go()
}

/** A launch still "running" whose tab is gone (no lock held) was interrupted: say so on the record and in its log. */
async function recoverLaunches(): Promise<void> {
  const l = locks()
  if (!l) return
  const held = new Set(((await l.query()).held ?? []).map((x) => x.name))
  for (const rec of readLaunches()) {
    if (rec.status !== "running" || held.has(launchLock(rec.id))) continue
    rec.status = "error"
    rec.error = "Interrupted: the tab running this launch was closed. Check the coin and the wallets before trying again."
    saveLaunch(rec)
    emitter(rec.id)("error", rec.error)
  }
}

// ── timed sells: localStorage, fired by whichever open tab gets the rule's lock first ──────────────────────────────

const readTimers = () => load<TimerRule[]>(`${P}.timers`, [])
function saveTimer(rule: TimerRule): void {
  const all = readTimers()
  const i = all.findIndex((r) => r.id === rule.id)
  if (i >= 0) all[i] = rule
  else all.push(rule)
  save(`${P}.timers`, all)
}
const timerLock = (id: string) => `${P}.timer.${id}`
const firing = new Set<string>()

async function fireTimer(id: string): Promise<void> {
  const run = async () => {
    const rule = readTimers().find((r) => r.id === id) // re-read: another tab may have fired it
    if (!rule || rule.status !== "pending") return
    rule.status = "running"
    saveTimer(rule)
    await fireRule(rule, (pks, mint, pct) => trading.sellAll(env(), pks, mint, pct))
    saveTimer(rule)
  }
  if (firing.has(id)) return
  firing.add(id)
  try {
    const l = locks()
    if (l) await l.request(timerLock(id), { ifAvailable: true }, async (lock) => { if (lock) await run() })
    else await run()
  } finally {
    firing.delete(id)
  }
}

/** Every 2 s: fire the rules that are due. A rule left "running" by a closed tab is marked interrupted. */
async function startTimers(): Promise<void> {
  const l = locks()
  if (l) {
    const held = new Set(((await l.query()).held ?? []).map((x) => x.name))
    for (const r of readTimers()) {
      if (r.status === "running" && !held.has(timerLock(r.id))) {
        r.status = "error"
        r.error = "Interrupted: the tab was closed while this sell ran. Check the balances before setting it again."
        saveTimer(r)
      }
    }
  }
  const tick = () => { for (const r of readTimers()) if (r.status === "pending" && r.dueAt <= Date.now()) void fireTimer(r.id) }
  tick()
  setInterval(tick, 2000)
}

// ── routes ──────────────────────────────────────────────────────────────────

const ok = (data: unknown, status = 200) => Response.json(data, { status })
const fail = (err: unknown, status?: number) => { const r = errorBody(err, status); return Response.json(r.body, { status: r.status }) }
async function body<T extends Record<string, unknown>>(req: Request): Promise<Partial<T>> {
  try { return (await req.json()) as Partial<T> } catch { return {} }
}

type Handler = (req: Request, params: string[]) => Promise<Response> | Response
/** [method, path pattern, handler, default status of a failure] — the same table as app/api/**. */
const routes: Array<[string, RegExp, Handler, number?]> = []
const route = (method: string, pattern: RegExp, h: Handler, failStatus?: number) => routes.push([method, pattern, h, failStatus])
const walletsView = () => ({ dir: KEYS_HOME, wallets: ks.list().map(info), mainWallet: ks.main(), archived: ks.archivedCount(), missing: [], pending: ks.pending().map((w) => ({ publicKey: w.publicKey, label: w.label })) })

// wallets
route("GET", /^\/api\/wallets$/, () => ok(walletsView()))
route("POST", /^\/api\/wallets$/, async (req) => {
  const b = await body<{ count: number; role: string; label: string }>(req)
  const wallets = createWallets(Number(b.count) || 1, isRole(b.role) ? b.role : "trader", typeof b.label === "string" ? b.label : undefined)
  return ok({ dir: `${KEYS_HOME}: press Download backup before funding`, wallets, mainWallet: ks.main() })
}, 409)
route("POST", /^\/api\/wallets\/import$/, async (req) => {
  const b = await body<{ privateKey: string; role: string; label: string }>(req)
  if (typeof b.privateKey !== "string" || !b.privateKey.trim()) throw new RouteError("privateKey (base58) is required")
  const k = parseSecret(b.privateKey)
  const role: Role = isRole(b.role) ? b.role : "trader"
  const { wallet, existed } = ks.add({ ...k, chain: CHAIN, role, label: (typeof b.label === "string" && b.label.trim()) || `Wallet ${ks.seen() + 1}`, createdAt: new Date().toISOString(), app: APP_NAME })
  return ok({ dir: KEYS_HOME, wallet: { ...info(wallet), path: KEYS_HOME, existed }, mainWallet: ks.main() })
}, 400)
route("POST", /^\/api\/wallets\/main$/, async (req) => {
  const b = await body<{ publicKey: string }>(req)
  if (typeof b.publicKey !== "string" || !b.publicKey) throw new RouteError("publicKey is required")
  return ok({ mainWallet: info(ks.setMain(b.publicKey)) })
})
route("POST", /^\/api\/wallets\/update$/, async (req) => {
  const b = await body<{ publicKey: string; label: string; role: string }>(req)
  if (typeof b.publicKey !== "string" || !b.publicKey) throw new RouteError("publicKey is required")
  if (b.role !== undefined && !isRole(b.role)) throw new RouteError("role must be one of funding, bundle, sniper, holder, trader")
  const w = ks.get(b.publicKey)
  if (!w) throw ks.missing(b.publicKey)
  return ok({ wallet: info(ks.update(b.publicKey, { label: cleanLabel(typeof b.label === "string" ? b.label : undefined, w.label), role: isRole(b.role) ? b.role : undefined })) })
})
route("POST", /^\/api\/wallets\/export$/, async (req) => {
  const targets = strings((await body<{ publicKeys: string[] }>(req)).publicKeys)
  if (!targets.length) throw new RouteError("publicKeys: at least one wallet")
  return ok({ wallets: ks.secrets(targets).map((r) => ({ publicKey: r.publicKey, privateKey: r.privateKey, label: r.label, file: KEYS_HOME })) })
})
route("POST", /^\/api\/wallets\/archive$/, async (req) => {
  const targets = strings((await body<{ publicKeys: string[] }>(req)).publicKeys)
  if (!targets.length) throw new RouteError("publicKeys: at least one wallet")
  return ok({ archived: ks.archive(targets), dir: `${KEYS_HOME} (archived wallets stay in every backup and export)` })
}, 409)
/** Demo only: `Download backup` (the not-yet-backed-up wallets) and `Export all keys` (every wallet). */
route("POST", /^\/api\/wallets\/backup$/, () => ok(ks.downloadBackup()))
route("POST", /^\/api\/wallets\/export-all$/, () => ok(ks.exportAll()))
/** Local mode's "Rewrite backups", in the browser: the same download as `Download backup`. */
route("POST", /^\/api\/wallets\/rewrite-backups$/, () => { const r = ks.downloadBackup(); return ok({ dir: KEYS_HOME, files: ks.list().length, restored: [], csvAdded: r.count, downloaded: r.files }) })
route("GET", /^\/api\/wallets\/balances$/, async (req) => {
  const q = new URL(req.url).searchParams
  return ok(await trading.balanceRows(env(), q.get("mint") || undefined, q.get("quoteMint") || undefined))
})
route("POST", /^\/api\/wallets\/fund$/, async (req) => {
  const b = await body<{ publicKeys: string[]; amount: number; amountSol: number }>(req)
  return ok(await fundDirect(env(), strings(b.publicKeys), num(b.amount ?? b.amountSol, 0)))
})
route("POST", /^\/api\/wallets\/(fund-exchange|fund-via-exchange)$/, async (req) => {
  const b = await body<{ publicKeys: string[]; amount: number; amountSol: number; mode: string; venue: string }>(req)
  const mode = (["float", "fixed", "private"].includes(String(b.mode)) ? b.mode : "float") as TransferMode
  return ok(await fundViaExchange(env(), strings(b.publicKeys), num(b.amount ?? b.amountSol, 0), mode, typeof b.venue === "string" && b.venue ? b.venue : "random"))
})
route("POST", /^\/api\/wallets\/gather$/, async (req) => ok(await gather(env(), strings((await body<{ publicKeys: string[] }>(req)).publicKeys))))
route("POST", /^\/api\/wallets\/close-accounts$/, async (req) => ok(await closeEmpty(env(), strings((await body<{ publicKeys: string[] }>(req)).publicKeys))))
route("GET", /^\/api\/transfer\/venues$/, async () => ok(await api().transferVenues()))
route("GET", /^\/api\/transfer\/([^/]+)$/, async (_req, [id]) => ok(await api().transferStatus(decodeURIComponent(id))))

// settings
const settingsView = () => {
  const s = settings()
  const key = readApiKey(KEY_OPTS)
  return { apiUrl: DEMO_API_URL, apiKeyConfigured: !!key, apiKeyPrefix: key ? maskKey(key) : null, apiKeyFrom: "browser", jitoTipLamports: s.jitoTipLamports, slippage: s.slippage, overrides: s.overrides, dir: KEYS_HOME, file: `${KEYS_HOME} (localStorage)`, demo: true, keyError: keyError() }
}
route("GET", /^\/api\/settings$/, async () => { await ensureApiKey(KEY_OPTS); return ok(settingsView()) })
route("PUT", /^\/api\/settings$/, async (req) => {
  const b = await body<{ apiKey: string | null; createKey: boolean; jitoTipLamports: number | null; slippage: number | null }>(req)
  if (b.createKey === true) await replaceApiKey(KEY_OPTS) // the API's refusal (rate_limited, …) is thrown verbatim
  if (b.apiKey !== undefined) setApiKey(KEY_OPTS, typeof b.apiKey === "string" ? b.apiKey : null)
  const cur = load<BrowserSettings>(`${P}.settings`, {})
  for (const k of ["jitoTipLamports", "slippage"] as const) {
    if (b[k] === undefined) continue
    const v = b[k]
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) cur[k] = v
    else delete cur[k]
  }
  save(`${P}.settings`, cur)
  return ok(settingsView())
})
route("GET", /^\/api\/settings\/status$/, async () => {
  const key = await ensureApiKey(KEY_OPTS)
  const a = api()
  const apiState: { configured: boolean; connected: boolean; url: string; keyPrefix?: string; error?: string; code?: string } = { configured: !!key, connected: false, url: a.url }
  const main = walletStore.main()
  let sol: number | null = null
  if (key) {
    try {
      const me = await a.me()
      apiState.connected = true
      apiState.keyPrefix = me.keyPrefix
      if (main) sol = await a.solBalance(main.publicKey).catch(() => null)
    } catch (e) {
      apiState.error = e instanceof Error ? e.message : String(e)
      if (e instanceof ApiError) apiState.code = e.code
    }
  } else {
    const k = keyError()
    if (k) { apiState.error = k.error; apiState.code = k.code }
  }
  return ok({ api: apiState, keyError: keyError(), funding: main ? { publicKey: main.publicKey, label: main.label, sol, backedUp: ks.isBackedUp(main.publicKey) } : null, backups: { dir: KEYS_HOME, wallets: ks.list().length, pending: ks.pending().length }, demo: true })
})

// launch
const form = async (req: Request) => readForm(await body(req), settings().slippage)
route("GET", /^\/api\/launch$/, () => ok({ launches: readLaunches().reverse() }))
route("POST", /^\/api\/launch$/, async (req) => {
  const f = await form(req)
  const rec = launch.prepareLaunch(env(), f)
  runInTab(rec, f)
  return ok({ id: rec.id, events: `/api/launch/${rec.id}/events`, launch: rec })
}, 400)
route("GET", /^\/api\/launch\/pairs$/, async (req) => ok(await api().pairs(new URL(req.url).searchParams.get("refresh") === "1")))
route("POST", /^\/api\/launch\/plan$/, async (req) => ok(await launch.fundingPlan(env(), await form(req))))
route("POST", /^\/api\/launch\/fund$/, async (req) => ok({ results: await launch.fundPlan(env(), await form(req)) }))
route("POST", /^\/api\/launch\/simulate$/, async (req) => { const e = env(); e.api.beginTrace(); const r = await launch.simulateLaunch(e, await form(req)); return ok({ ...r, calls: e.api.endTrace() }) })
route("GET", /^\/api\/launch\/([^/]+)$/, (_req, [id]) => { const rec = readLaunches().find((l) => l.id === id); return rec ? ok(rec) : fail(new Error("Launch not found"), 404) })

// IPFS: the visitor's FormData goes straight to the API with their key
route("POST", /^\/api\/ipfs$/, async (req) => {
  const fd = await req.formData()
  if (!(fd.get("file") instanceof Blob)) throw new RouteError("file (png / jpg / gif / webp, up to 4 MB) is required")
  if (!fd.get("name") || !fd.get("symbol")) throw new RouteError("name and symbol are required")
  if (!fd.has("showName")) fd.set("showName", "true")
  return ok(await api().uploadMetadata(fd))
})

// trading
const coin = (req: Request) => new URL(req.url).searchParams.get("mint") || ""
route("GET", /^\/api\/trading\/token$/, async (req) => {
  const mint = coin(req)
  if (mint.length < 32) throw new RouteError("mint is required")
  return ok(await trading.tokenInfo(env(), mint))
})
route("POST", /^\/api\/trading\/buy$/, async (req) => {
  const b = await body<{ publicKey: string; mint: string; amount: number; sol: number; partialFill: boolean }>(req)
  const amount = num(b.amount ?? b.sol, 0)
  if (typeof b.publicKey !== "string" || typeof b.mint !== "string") throw new RouteError("publicKey and mint are required")
  if (!(amount > 0)) throw new RouteError("amount must be greater than zero")
  return ok(await trading.buy(env(), b.publicKey, b.mint, amount, undefined, b.partialFill === true))
})
route("POST", /^\/api\/trading\/sell$/, async (req) => {
  const b = await body<{ publicKey: string; mint: string; percent: number }>(req)
  if (typeof b.publicKey !== "string" || typeof b.mint !== "string") throw new RouteError("publicKey and mint are required")
  return ok(await trading.sell(env(), b.publicKey, b.mint, num(b.percent, 100)))
})
route("POST", /^\/api\/trading\/sell-all$/, async (req) => {
  const b = await body<{ publicKeys: string[]; mint: string; percent: number }>(req)
  const wallets = strings(b.publicKeys)
  if (!wallets.length || typeof b.mint !== "string") throw new RouteError("publicKeys and mint are required")
  return ok({ results: await trading.sellAll(env(), wallets, b.mint, num(b.percent, 100)) })
})
route("GET", /^\/api\/trading\/creator-fees$/, async (req) => {
  const mint = coin(req)
  if (!mint) throw new RouteError("mint is required")
  return ok(await trading.creatorFees(env(), mint))
})
route("POST", /^\/api\/trading\/creator-fees$/, async (req) => {
  const b = await body<{ mint: string }>(req)
  if (typeof b.mint !== "string") throw new RouteError("mint is required")
  return ok(await trading.collectCreatorFees(env(), b.mint))
})
route("GET", /^\/api\/trading\/timers$/, (req) => ok({ now: Date.now(), timers: readTimers().filter((r) => !coin(req) || r.mint === coin(req)).sort((a, b) => a.dueAt - b.dueAt) }))
route("POST", /^\/api\/trading\/timers$/, async (req) => {
  const b = await body<{ mint: string; publicKeys: string[]; percent: number; minutes: number }>(req)
  if (typeof b.mint !== "string") throw new RouteError("mint is required")
  const rule = newTimerRule({ mint: b.mint, publicKeys: strings(b.publicKeys), percent: num(b.percent, 100), minutes: num(b.minutes, 5) })
  saveTimer(rule)
  return ok(rule)
}, 400)
const cancelTimer = (id: string) => {
  const rule = readTimers().find((r) => r.id === id)
  if (!rule) return fail(new Error("Timer not found"), 404)
  if (rule.status === "pending") { rule.status = "cancelled"; saveTimer(rule) }
  return ok(rule)
}
route("DELETE", /^\/api\/trading\/timers$/, (req) => {
  const id = new URL(req.url).searchParams.get("id")
  if (id) return cancelTimer(id)
  const keep = readTimers().filter((r) => !isFinished(r))
  const cleared = readTimers().length - keep.length
  save(`${P}.timers`, keep)
  return ok({ cleared })
})
route("DELETE", /^\/api\/trading\/timers\/([^/]+)$/, (_req, [id]) => cancelTimer(decodeURIComponent(id)))

// vanity
route("GET", /^\/api\/vanity\/pool$/, () => {
  const entries = vanity.pool()
  return ok({ file: `${KEYS_HOME} (localStorage)`, available: entries.filter((e) => e.status === "available").length, used: entries.filter((e) => e.status === "used").length, entries })
})
route("GET", /^\/api\/vanity\/random$/, () => ok({ publicKey: generateKey().publicKey, note: "A launch with mint mode 'random' generates its own key and saves it to the pool as used." }))
route("GET", /^\/api\/vanity\/status$/, () => ok(vanity.jobStatus()))
route("POST", /^\/api\/vanity\/start$/, async (req) => {
  const b = await body<{ suffix: string; prefix: string; caseSensitive: boolean }>(req)
  return ok(await vanity.startJob({ suffix: typeof b.suffix === "string" ? b.suffix : "", prefix: typeof b.prefix === "string" ? b.prefix : "", caseSensitive: b.caseSensitive !== false }))
}, 400)

/** One request → the route's Response (404 for an unknown path, the API's error shape for every failure). */
export async function handle(req: Request): Promise<Response> {
  const path = new URL(req.url).pathname
  for (const [method, pattern, h, failStatus] of routes) {
    if (method !== req.method) continue
    const m = pattern.exec(path)
    if (!m) continue
    try {
      return await h(req, m.slice(1))
    } catch (e) {
      return fail(e, failStatus)
    }
  }
  return fail(new Error(`No route ${req.method} ${path} in the browser engine`), 404)
}

// ── event streams (the server's sse routes) ─────────────────────────────────

/** GET /api/launch/:id/events: the log so far, then every new stage until done / error. */
function launchEvents(id: string): EventStream {
  return (send, close) => {
    const history = eventsOf(id)
    for (const e of history) send(e)
    const rec = readLaunches().find((l) => l.id === id)
    if (!rec) { send({ at: Date.now(), stage: "error", message: "Launch not found" }); close(); return () => {} }
    const finished = (stage: string) => stage === "done" || stage === "error"
    if (history.some((e) => finished(e.stage)) || (rec.status !== "running" && !history.length)) {
      if (!history.length) send({ at: Date.now(), stage: rec.status === "error" ? "error" : "done", message: rec.error ?? `Launch ${rec.status}`, mint: rec.mint ?? undefined })
      close()
      return () => {}
    }
    return subscribeLaunch(id, (e) => { send(e); if (finished(e.stage)) close() })
  }
}

/** GET /api/trading/feed?mint=…: the API websocket (wss://…/api/sol/data?api-key=…) opened from this tab. */
function tradeFeed(mint: string): EventStream {
  return (send) => {
    let ws: WebSocket | null = null
    let stopped = false
    let retry: ReturnType<typeof setTimeout> | null = null
    let first = true
    const seen = new Set<string>()
    const connect = () => {
      const a = api()
      if (!a.configured) { retry = setTimeout(connect, 3000); return } // the key is still being created
      ws = new WebSocket(a.wsUrl())
      ws.onopen = () => {
        ws?.send(trading.tradeSubscription(mint))
        if (first) {
          first = false
          send({ type: "initial", trades: [] })
          // the history (GET /api/sol/trades): the dev buy and the bundle, everything before this tab subscribed
          void a.tradeHistory(mint, 100).then((h) => {
            const trades: ReturnType<typeof trading.parseTrade>[] = []
            for (const raw of h.trades) { const t = trading.parseTrade(JSON.stringify(raw), mint, (trader) => walletStore.get(trader) ?? undefined); if (t && !seen.has(t.signature)) { seen.add(t.signature); trades.push(t) } }
            if (!stopped) send({ type: "initial", trades })
          }).catch(() => {})
        }
      }
      ws.onmessage = (m) => {
        const t = trading.parseTrade(String(m.data), mint, (trader) => walletStore.get(trader) ?? undefined)
        if (!t || seen.has(t.signature)) return
        seen.add(t.signature)
        send({ type: "trade", trade: t })
      }
      ws.onclose = () => { if (!stopped) retry = setTimeout(connect, 3000) }
    }
    connect()
    return () => { stopped = true; if (retry) clearTimeout(retry); try { ws?.close() } catch { /* closing */ } }
  }
}

/** The event stream of a path, or null when it has none. */
export function stream(url: URL): EventStream | null {
  const m = /^\/api\/launch\/([^/]+)\/events$/.exec(url.pathname)
  if (m) return launchEvents(decodeURIComponent(m[1]))
  if (/^\/api\/trading\/(feed|trades)$/.test(url.pathname)) {
    const mint = url.searchParams.get("mint") || ""
    return mint.length >= 32 ? tradeFeed(mint) : null
  }
  return null
}

// ── start-up: the visitor's key, interrupted launches, timed sells ───────────

if (typeof window !== "undefined") {
  void ensureApiKey(KEY_OPTS)
  void recoverLaunches().catch(() => {})
  void startTimers().catch(() => {})
}

