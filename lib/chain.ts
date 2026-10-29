/**
 * What differs between the pump.fun starter and the pons starter on the shared pages: the chain's name, its native
 * coin, how addresses look, where things are seen, and which extras exist. Client-safe (no node imports). The pages
 * under app/wallets and app/trading and the components are the same files in both apps; only this one differs.
 */
export type ChainConfig = {
  name: string
  symbol: string
  /** the query / body field a coin travels in on this app's routes */
  coinParam: "mint" | "token"
  coinNoun: string
  keyNoun: string
  isAddress: (s: string) => boolean
  isCoin: (s: string) => boolean
  short: (s: string) => string
  /** a native amount for a table cell */
  fmt: (n: number | null | undefined) => string
  explorerAddress: (address: string) => string
  explorerTx: (sig: string) => string
  coinLinks: (coin: string) => Array<{ label: string; href: string }>
  /** GMGN's embeddable candle chart (gmgn.cc is their widget host; gmgn.ai refuses to be framed), or null when the chain has none */
  chartUrl: (coin: string, theme: "dark" | "light") => string | null
  /** the launch-log stream of this app, and one entry of it read into a common shape (the pump.fun and pons routes differ) */
  launchLog: { path: (id: string) => string; read: (e: Record<string, unknown>) => { stage: string; message: string; done: boolean; error: boolean } }
  /** the "Set every amount to" pills, in the native coin */
  pills: string[]
  /** the default of the "Amount each" input (funding) and of a buy */
  defaultEach: string
  defaultBuy: string
  features: {
    /** Solana: empty token accounts hold rent that "Close empty token accounts" recovers */
    tokenAccounts: boolean
    /** pump.fun pays the creator a share of the trading fees */
    creatorFees: boolean
    /** pump.fun Mayhem coins: a buy past the remaining supply needs `partial fill` */
    mayhem: boolean
  }
}

const ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

export const chain: ChainConfig = {
  name: "Solana",
  symbol: "SOL",
  coinParam: "mint",
  coinNoun: "mint address",
  keyNoun: "base58 secret key",
  isAddress: (s) => ADDR.test(s.trim()),
  isCoin: (s) => ADDR.test(s.trim()),
  short: (s) => (s.length > 11 ? `${s.slice(0, 4)}…${s.slice(-4)}` : s),
  fmt: (n) => (n === null || n === undefined ? "–" : n.toFixed(4)),
  explorerAddress: (a) => `https://solscan.io/account/${a}`,
  explorerTx: (sig) => `https://solscan.io/tx/${sig}`,
  coinLinks: (mint) => [
    { label: "pump.fun", href: `https://pump.fun/coin/${mint}` },
    { label: "gmgn", href: `https://gmgn.ai/sol/token/${mint}` },
    { label: "dexscreener", href: `https://dexscreener.com/solana/${mint}` },
    { label: "solscan", href: `https://solscan.io/token/${mint}` },
  ],
  chartUrl: (mint, theme) => `https://www.gmgn.cc/kline/sol/${mint}?theme=${theme}`,
  launchLog: {
    path: (id) => `/api/launch/${id}/events`,
    read: (e) => ({ stage: String(e.stage ?? ""), message: String(e.message ?? ""), done: e.stage === "done" || e.stage === "error", error: e.stage === "error" }),
  },
  pills: ["0.01", "0.05", "0.1", "0.5", "1"],
  defaultEach: "0.05",
  defaultBuy: "0.05",
  features: { tokenAccounts: true, creatorFees: true, mayhem: true },
}
