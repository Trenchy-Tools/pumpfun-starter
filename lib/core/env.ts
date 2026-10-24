/**
 * What the shared flows (lib/core/launch.ts, trading.ts, funding.ts) need from the outside world, as one object.
 *
 *   local mode  lib/wallets.ts + lib/vanity.ts + lib/launch.ts (files in the backup folder), key from settings.json/.env
 *   demo mode   lib/browser/keystore.ts + the browser engine (localStorage), the visitor's own key
 *
 * Every method is synchronous on purpose: both stores are (fs sync calls / localStorage), and the flows read like the
 * server code they came from. No node imports.
 */
import type { Keypair } from "@solana/web3.js"
import type { Trenchy } from "../trenchy"
import type { Role, WalletInfo } from "./wallet-record"

export type WalletStore = {
  /** where keys live, for messages: "folder" (local mode: "not in the folder") or "browser" ("not in this browser") */
  place: "folder" | "browser"
  /** every usable wallet (not archived), oldest first; `role` filters by the tag */
  list(role?: Role): WalletInfo[]
  get(publicKey: string): WalletInfo | null
  /** the ★ wallet: pays for everything, receives gathers, is the default creator */
  main(): WalletInfo | null
  /** the backup rule: throws NotBackedUpError unless the key is safely backed up */
  assertBackedUp(publicKey: string): void
  /** the signer; throws NotBackedUpError when the wallet is unknown or not backed up */
  keypairOf(publicKey: string): Keypair
  /** create (and store) `count` wallets; the first wallet ever becomes ★ */
  create(count: number, role?: Role, label?: string): WalletInfo[]
  /** one line for the Simulate "backup" check: where the key is kept */
  backupNote(w: WalletInfo): string
}

/** The vanity / random mint keys a launch takes (stored before use, so every launch can be traced to its key). */
export type MintPool = {
  takeForLaunch(launchId: string, publicKey?: string): Keypair
  randomForLaunch(launchId: string): Keypair
}

export type Env<LaunchRecord = unknown> = {
  api: Trenchy
  wallets: WalletStore
  mints: MintPool
  launches: { list(): LaunchRecord[]; save(rec: LaunchRecord): void }
  /** the Jito tip in lamports, and the default slippage (%) of trades */
  jitoTipLamports: number
  slippage: number
}

/** "not in folder" / "not in this browser" (a plan row label), or with `the` for a sentence ("is not in the folder"). */
export const notIn = (w: WalletStore, sentence = false) => (w.place === "folder" ? (sentence ? "not in the folder" : "not in folder") : "not in this browser")

/** Defaults both modes use when the visitor / settings.json / .env says nothing. */
export const DEFAULT_API_URL = "https://api.trenchy.tools"
/** 0.005 SOL, paid inside the create transaction of a launch bundle */
export const DEFAULT_TIP_LAMPORTS = 5_000_000
/** percent */
export const DEFAULT_SLIPPAGE = 15
