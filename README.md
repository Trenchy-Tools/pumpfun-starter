<!-- trenchytools:header -->
<p align="center"><img src="./.github/social.png" alt="pump.fun starter" width="100%"></p>

<p align="center"><a href="https://pumpfun.trenchy.tools"><b>Live demo</b></a> · <a href="https://trenchy.tools/docs">Docs</a> · <a href="https://api.trenchy.tools/api/create-api-key">Get an API key</a> · <a href="https://api.trenchy.tools/AGENTS.md">AGENTS.md</a> · <a href="https://api.trenchy.tools/openapi.json">OpenAPI</a> · <a href="https://trenchy.tools/status">Status</a> · <a href="https://t.me/trenchytools">Telegram</a> · <a href="https://x.com/trenchytools">X</a></p>

# pump.fun starter

The official starter for pump.fun launches on the [TrenchyTools API](https://api.trenchy.tools).
One Next.js app: wallets, Jito-bundled launches with up to 16 buyers, snipers and holder auto-buys, trading with timed sells, vanity mints.
The API builds the unsigned transactions; this app signs them with the key files in its `wallets/` folder and sends them.

> ### ⚡ Start here
> **Website:** [trenchy.tools](https://trenchy.tools) · **Docs:** [trenchy.tools/docs](https://trenchy.tools/docs) · **All examples:** [trenchy.tools/docs/examples](https://trenchy.tools/docs/examples) · **Code:** [github.com/Trenchy-Tools](https://github.com/Trenchy-Tools)
> **Try it without installing:** [pumpfun.trenchy.tools](https://pumpfun.trenchy.tools) (wallets stay in your browser; download the backup before funding anything)

## Tutorial: your first launch in 5 steps

1. **Get a key** (one call, no account): `curl "https://api.trenchy.tools/api/create-api-key?label=me"` → paste the `apiKey` into `.env` as `TRENCHY_API_KEY`, then `npm install && npm run dev` and open http://localhost:3000.
2. **Make a wallet.** Wallets → **+ New wallet**. The first one becomes ★ (the main wallet); its key is written to `./wallets` (inside the clone, git-ignored) before it shows up. Send it a little SOL (copy the address from the row).
3. **Fill the coin in.** Launch → drop an image, type a name and a symbol. The image goes to IPFS by itself when you launch.
4. **Pick the buys.** Dev buy (0.1–2 SOL chips), how many **Bundle buyers** (0–16) and **Holder wallets** (0–10), an amount each. Every row is a *new wallet* unless you pick an existing one; the **Cost** card on the right shows what leaves ★. Press **Simulate** for a dry run.
5. **Launch.** The button says what is missing until it says `Launch (x SOL)`. New wallets are created, ★ funds every buyer, the Jito bundle goes out, and the moment the coin is live the **Trading** page opens on it: the GMGN chart, every wallet with its tokens, **25 / 50 / 100 %** sell buttons and timed sells.

Everything else (pair, Mayhem, holder rewards, creator fee, dev wallet, slippage, snipers, Jito) is under **Advanced options** on the Launch page.

## 5-minute start

```bash
git clone https://github.com/Trenchy-Tools/trenchytools-pumpfun-launcher && cd trenchytools-pumpfun-launcher
npm install
cp .env.example .env
curl "https://api.trenchy.tools/api/create-api-key?label=pumpfun-starter"   # → {"apiKey":"…"}; paste it into .env as TRENCHY_API_KEY
npm run dev
```

Open http://localhost:3000. The top bar shows three pills: API key state, the ★ wallet + SOL, and the folder your keys live in.
Press **+ New wallet** on the Wallets page (the first one becomes ★), send it some SOL, and you are ready to launch. The Settings
sheet (gear icon) checks the key with `GET /api/me` and can hold the key instead of `.env`.

## Wallets

One list. **+ New wallet** makes a wallet on the spot (label *Wallet N*; the `× N` box makes several), **Import ▾** takes a
base58 key. The ★ wallet is the main one: it pays for everything, receives gathers and creates launches; the first wallet
ever added is ★, click ☆ on any row to move it. Click a label to rename it (an optional role tag lives there too). Per row:
address (copy), SOL, the coin's balance when one is chosen on Trading, **Fund** (an amount, sent from ★) and **Key** (shows
the secret, with copy). Tick rows and a bar appears: **Amount each · Fund from ★ · Fund via exchange ▾** (mode + venue
inline; each wallet is paid by an exchange hot wallet instead of ★) **· Gather to ★ · Close empty token accounts · Export
keys · Archive** (the key files move to `archived/`, nothing is deleted). Every result is a toast; an API error is shown
verbatim. Keys are files in the folder named at the top of the page; **Rewrite backups** restores missing ones.

## Where your keys are

Every wallet this app makes is a file, written **before** the wallet is handed back and long before it holds anything:

```
WALLET_BACKUP_DIR                       when set in .env
./wallets                               otherwise: inside the cloned repo, git-ignored
  2026-10-23T02-15-09-443Z-sol-bundle-7yhTk….json   { publicKey, privateKey (base58), chain, role, label, createdAt, app }
  wallets.csv                                        createdAt,chain,role,label,publicKey,privateKey (one line per wallet)
  _app/pumpfun-starter/                              settings.json, launches.json, vanity-pool.json
```

- That folder **is** the wallet store: the Wallets page lists it by reading the files. Nothing is funded, used as the creator,
  bundled or gathered unless its file exists; a missing file answers `409 not_backed_up`. "Rewrite backups" restores a
  missing file from its `wallets.csv` line (idempotent).
- The ★ wallet is the public key in `_app/pumpfun-starter/settings.json` (`mainWallet`); a wallet with the old role
  `funding` counts as ★ when nothing is set. `role` in a file is only a tag now (bundle / sniper / holder / trader):
  launches take the wallets you tick on the Launch page, with an amount each.
- `archived/` holds the files of archived wallets: keys kept, never listed, never used.
- Every file carries `chain: "sol"`; the folder is shared with sibling starters that write `chain: "rh" | "eth" | "bnb"`
  files for 0x keys, which this app ignores. The file name is `<date>-<chain>-<role>-<publicKey>.json`.
- This app's own state lives in `_app/pumpfun-starter/` inside the folder, never anywhere else.
- Mint keypairs hold no funds and are not wallets: they live in `vanity-pool.json`, not among the wallet files.

Keep the folder. Anyone with a file controls that wallet. Losing it is losing the money.

## How a launch works

The Launch page is three things: the coin (image, name, symbol), the buys (dev buy; how many **bundle buyers** and
**holder wallets**, an amount each, every row a *new wallet* unless you pick an existing one) and the mint (random or
vanity). Press **Launch**: the image goes to IPFS by itself, the new wallets are created (keys saved first), the ★ wallet
funds every buyer, the bundle goes out, and the moment the coin is live the **Trading** page opens on it with the chart
and your wallets. Pair, Mayhem, holder rewards, creator fee, dev wallet, slippage, snipers and the Jito switch sit under
**Advanced ▾**.

`lib/launch.ts`, top to bottom. Each step names the endpoint it calls:

0. **Image** — `POST /api/ipfs` with the image + name / symbol / description / links → `metadataUri` (done by the page as Launch starts; Simulate does it too).
1. **Wallets** — the dev (★ unless changed) is the creator; the bundle, snipers and holders are the rows on the Launch page, each with its own amount (`bundle.wallets: [{ publicKey, amount }]`; `publicKey: null` = a new wallet, created and backed up before anything else; the old `count × solEach` shape still works and picks by role); `assertBackedUp` on every key.
2. **Mint** — a vanity key from the pool (`POST /api/sol/vanity` ground it earlier) or `Keypair.generate()`, saved to the pool as used.
3. **Funding** (optional) — SOL from the funding wallet to each buyer per the funding plan: buy + 0.5 % API fee + 0.01 SOL reserve; the dev also pays the Jito tip and 0.02 SOL table rent when a table is used. Plain transfers: `GET /api/sol/blockhash` → sign → `POST /api/sol/send` → `GET /api/sol/tx/:sig`.
4. **Lookup table** (5–16 bundle buyers) — `POST /api/sol/lut` → sign + send each transaction → `GET /api/sol/lut/:address` until `ready`. Closed after the launch (`deactivate`, then `close` ~4 min later) to refund the rent.
5. **Bundle** — `POST /api/sol/trade-local` with an **array**: the `create` (+ dev buy; its `priorityFee` is the Jito tip) followed by the buys (one wallet per transaction, or `buyers: [...]` + `lookupTable` for 4 per transaction) → sign each → `POST /api/sol/simulate` on the create → `POST /api/sol/bundle` → `GET /api/sol/bundle/:id` and `GET /api/sol/tx/:sig`. If Jito refuses or the bundle does not land, the create goes out alone through `POST /api/sol/send` and the buys follow one by one.
6. **Snipers** — the moment the create is confirmed: `trade-local` buy → sign → `send`, one every `gapMs` (default 400 ms).
7. **Holders** — after `delayS`, buys spread over `windowS` (default 120 s) with jitter.
8. **Record** — `launches.json` (mint, wallets by role, signatures, lookup table). Every stage streams to the Launch page as server-sent events (`GET /api/launch/:id/events`); the `live` stage sends the browser to `/trading?mint=…&launch=<id>`, where the same stream keeps showing the holder buys.

**Simulate** runs the checks (key, funding wallet file, balance vs plan) and builds the create + dev buy with a throwaway mint, then `POST /api/sol/simulate`. Nothing is sent.

## Custom pairs and Mayhem

A pump.fun coin is priced and traded in a **quote asset**. SOL is the default; the Launch page's **Pair with** select
(`GET /api/sol/pairs`, cached 10 min by `lib/trenchy.ts pairs()`) offers USDC, tokenized stocks (`SPYx`, `NVDAx`, …),
WBTC, PUMP and the other listed assets, grouped stable / stock / crypto / pump. The pair is fixed at creation
(`quoteMint` on the create) and the coin's PumpSwap pool keeps it after graduation. Three options sit next to it:

| Option | What it does | Where it is allowed |
| --- | --- | --- |
| **Pair with** | The dev buy and every buyer amount are in that asset (the inputs are labelled `USDC each`, `SPYx each`, …). Buys are sent with `denominatedInQuote: "true"`; sells and `pool: "auto"` are unchanged. | any listed asset, or any pump.fun coin's mint |
| **Mayhem mode** (`mayhemMode`) | pump.fun's own agent trades the coin for its first 24 h with randomized, roughly balanced buys and sells; supply is 2 B (the agent's extra billion is burned at the end); no synthetic migration, so a buy past the remaining supply fails unless the Trading page's **partial fill** box is ticked (`partialFill: true`). | SOL or USDC coins only — a stock pair is refused by the API with `422 mayhem_quote_not_allowed`, shown verbatim |
| **Creator fee (bps)** (`creatorFeeBps`) | Your own creator fee on every trade, 100 = 1 % (pump.fun's UI offers 5–100 bps; the API applies the on-chain max). Empty = pump.fun's schedule. | custom pairs only (`422 creator_fee_not_allowed` on SOL / USDC) |
| **Holder rewards** (`holderReward`) | The creator fee goes to the coin's holders instead of the creator, permanently. | any pair |

**Wallets must hold the quote asset.** On a custom pair the funding plan reads each wallet's balance of it
(`GET /api/sol/balances?wallets=…&mint=<quote mint>`), compares it with buy + slippage and refuses the launch with a
per-wallet list — *send 12.5 USDC to 7yhT…* — until every wallet holds enough. This app never moves the quote asset
(no exchange hop, no transfer); send it yourself. The API answers a short wallet with `409 no_quote_balance`
(`needed`, `have`, `quote`, `account`), which `ApiError.extra` keeps and the UI shows.

**Fees are still SOL.** Network fees and the API's 0.5 % fee (the SOL value of the trade at a market price, floored at
0.0001 SOL) come out of each wallet's SOL, so the plan keeps a SOL reserve per wallet (0.01 + 0.002) and the
*Fund first* step still tops up SOL. The Trading page labels the Buy input in the quote asset, shows sells as
`quoteAmount SYMBOL`, and the Wallets page adds a quote-asset balance column when the selected launch is a custom pair.

Docs: [Custom pairs](https://trenchy.tools/docs/sol/pairs) ·
[Mayhem mode](https://trenchy.tools/docs/sol/mayhem).

## Trading & timed sells

Pick one of your launches or paste a mint (a launch brings you here by itself: `/trading?mint=…`). GMGN's candle chart
sits under the header (`https://www.gmgn.cc/kline/sol/<mint>`, their embeddable widget host; `open on GMGN` next to it).
Every wallet is a row with its SOL, its tokens and their value
(`GET /api/sol/balances?wallets=…&mint=…`), then **[amount] Buy** and **25% · 50% · 100%** sell buttons that act at once; the
result (or the API's error, verbatim) is a toast. Tick rows for the bar: **Buy [x] each · Sell 25 / 50 / 100 % of selected ·
Timed sell ▾** (*in N minutes sell X %*, kept in server memory, `lib/timers.ts`). Each trade is `POST /api/sol/trade-local`
with `pool: "auto"` (follows the coin from the curve to PumpSwap) → sign → `POST /api/sol/send` → `GET /api/sol/tx/:sig`.
On a Mayhem coin a **partial fill** box sits in the Buy column header. **Live trades** on the right come from the API
websocket (`wss://…/api/sol/data`, `subscribeTokenTrade`) relayed as server-sent events (`connecting… / no trades yet / N
trades`), our wallets flagged; the **Creator fees** row reads `GET /api/sol/creator-fees` and claims with
`trade-local { action: "collectCreatorFee" }`.

## Vanity

Suffix / prefix (≤ 4 characters together, `pump` by default), case sensitivity. `POST /api/sol/vanity` starts a job on the API's workers;
the page shows `expectedAttempts`, attempts and rate from `GET /api/sol/vanity/:jobId`; the keypair arrives once and is written to
`_app/pumpfun-starter/vanity-pool.json` at that moment. Common suffixes come from a warm pool and are done instantly. The Launch page picks from the pool.

## The one file to copy

[`lib/trenchy.ts`](lib/trenchy.ts) is the whole API client: one documented method per endpoint, `ApiError { status, code, hint, docs }`
for every error, retries on 429 and on an unreachable host, safe re-send of plain transfers (same signed bytes until the blockhash dies).
It depends only on `@solana/web3.js`, `bs58`, `buffer` and [`lib/core/errors.ts`](lib/core/errors.ts), takes the key in its constructor,
and runs in Node and in the browser alike. Copy it into any project.

Every API error is shown in the UI exactly as returned: `message · code · hint · docs link` ([`components/api-error.tsx`](components/api-error.tsx)).

## Build it with AI

Paste this into your coding agent:

> Read https://api.trenchy.tools/AGENTS.md first, then `lib/trenchy.ts` in this repo (the API client; one method per endpoint) and
> `lib/wallets.ts` (the wallet folder rule: every key is a file on disk before it is funded; refuse otherwise). Using only those two
> files, build me a TypeScript tool that <describe it>. Rules: never invent endpoints, sign every transaction locally with keys from the
> wallet folder, simulate before the first send (`POST /api/sol/simulate`), start with tiny sizes, show every API error with its `code`,
> `hint` and `docs`, and never write a key anywhere but the wallet folder or `.env`.

## Host it

```bash
docker build -t pumpfun-starter .
docker run -p 3000:3000 -v pumpfun-data:/data -e TRENCHY_API_KEY=… pumpfun-starter
```

The image runs Next's standalone server (`node server.js`). Mount a volume at `/data`: wallet files are written to `/data/wallets`
(`WALLET_BACKUP_DIR` is set in the image). Environment: `TRENCHY_API_KEY`, optional `TRENCHY_API_URL`, `JITO_TIP_LAMPORTS`, `PORT`.
There is no auth layer: this is a single-user tool. Put it behind your own login or keep it on localhost.

## Hosted demo mode

The public demo (`pumpfun.trenchy.tools`) is this same app built in **demo mode**, so strangers can use it without anyone
holding their keys:

```bash
NEXT_PUBLIC_DEMO=1 npm run build          # build-time flag: the pages talk to the in-browser engine
DEMO_MODE=1 node .next/standalone/server.js   # runtime flag: every /api/* route answers 404 { code: "demo_mode" }
```

What differs from local mode (which is unchanged without the flags):

- **Keys live in the visitor's browser** (`localStorage`, one entry per wallet, same shape as a wallet file). Signing happens in
  the tab. The server keeps no state and serves no wallet route ([`proxy.ts`](proxy.ts) → `demoGuard` in `lib/http.ts`).
- **Backup first:** a new wallet is *not backed up* and cannot be funded, launched with, traded or gathered (`409 not_backed_up`)
  until **Download backup** (top bar or Wallets page) has saved its key as a JSON + CSV download. **Export all keys** downloads
  everything any time. Clearing the site's data deletes the keys.
- **Each visitor gets their own API key**, created in the browser on the first visit (`GET /api/create-api-key?label=demo-pumpfun`)
  and kept in `localStorage`. Settings shows it masked, takes a pasted key, and shows the API's refusal verbatim when creation is
  rate-limited. Every API call (and the live-trades websocket) goes straight from the browser to `https://api.trenchy.tools`.
- **Launches and timed sells run in the tab**: keep it open. Timed sells are kept in `localStorage` and resume on reload.
- A strict Content-Security-Policy is sent (`next.config.ts`): scripts from this origin only, network to this origin and the API only.

How it is built: the pages call their routes through `appFetch` / `appEvents` ([`lib/browser/demo.ts`](lib/browser/demo.ts)).
In demo mode those are answered by [`lib/browser/engine.ts`](lib/browser/engine.ts), which has the same routes and shapes and
runs the same flows as the server ([`lib/core/*`](lib/core): launch executor, trading, funding, vanity, timers), on the
browser key store ([`lib/browser/keystore.ts`](lib/browser/keystore.ts)).

## Routes (the backend)

| Route | What it does |
| --- | --- |
| `GET/POST /api/wallets`, `POST /api/wallets/{import,main,update,archive,export}` | list the folder (+ `mainWallet`) · create N wallets (files first) · import a base58 key · set ★ · rename / tag · archive · read keys |
| `POST /api/wallets/fund`, `/fund-exchange`, `/gather`, `/close-accounts`, `/rewrite-backups`, `GET /api/wallets/balances` | funding from ★ · exchange-routed funding (`POST /api/transfer/batch`) · sweep to ★ · close empty token accounts · idempotent export · balances |
| `GET /api/transfer/venues`, `GET /api/transfer/:id` | open exchange venues · transfer status |
| `GET/POST /api/launch`, `GET /api/launch/:id`, `GET /api/launch/:id/events`, `POST /api/launch/{plan,fund,simulate}` | records · start · record · SSE log · funding plan · fund the plan · dry run |
| `POST /api/trading/{sell,buy,sell-all}`, `GET/POST/DELETE /api/trading/timers`, `DELETE /api/trading/timers/:id`, `GET/POST /api/trading/creator-fees`, `GET /api/trading/trades` | trades · timed sells · creator fees · live trades (SSE) |
| `POST /api/vanity/start`, `GET /api/vanity/{status,pool,random}` | grind · progress · pool · random preview |
| `GET/PUT /api/settings`, `GET /api/settings/status` | settings · the top-bar pills |
| `POST /api/ipfs` | multipart passthrough to the API's `POST /api/ipfs` |

MIT. Support: Telegram https://t.me/trenchytools · X @trenchytools.
