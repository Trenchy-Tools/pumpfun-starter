<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- trenchytools:agents -->
## Working on this repo with an AI agent

This app is a starter for the TrenchyTools API (Solana). Before changing it:

1. Read https://api.trenchy.tools/AGENTS.md (the API's rules) and https://api.trenchy.tools/openapi.json (every endpoint). Use only endpoints that exist there.
2. Every API call goes through `lib/trenchy.ts`. Add new calls there, one documented method per endpoint.
3. Wallet backup rule: a wallet is written to its JSON file in the wallet folder BEFORE it is used or funded, and nothing funds a wallet whose file is missing (`assertBackedUp`). Never weaken this.
4. Signing happens in this app: the API returns unsigned transactions, this app signs and sends them.
5. Show API errors as returned (message, code, hint, docs). Never print secrets, keys or the API key.
