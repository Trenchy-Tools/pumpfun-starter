import type { NextConfig } from "next"

/**
 * Demo mode (NEXT_PUBLIC_DEMO=1 at build time): the hosted app keeps every wallet key in the visitor's browser, so the
 * page gets a strict Content Security Policy. Scripts only from this origin, network only to this origin and the
 * TrenchyTools API (https + wss), no framing. Keys in browser storage are only as safe as the page that holds them.
 * ('unsafe-inline' scripts: Next's inline bootstrap needs them; styles: the theme switcher and Tailwind.)
 */
const DEMO = process.env.NEXT_PUBLIC_DEMO === "1"
const CSP = [
  "default-src 'self'",
  "connect-src 'self' https://api.trenchy.tools wss://api.trenchy.tools",
  "img-src 'self' data: blob: https:",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  // the Trading page embeds GMGN's chart widget
  "frame-src https://www.gmgn.cc",
  "frame-ancestors 'none'",
].join("; ")

const nextConfig: NextConfig = {
  // self-contained server for the Dockerfile (node server.js)
  output: "standalone",
  // the live-trades websocket client runs in route handlers on Node; keep it out of the bundle
  serverExternalPackages: ["ws"],
  async headers() {
    if (!DEMO) return []
    return [{ source: "/:path*", headers: [
      { key: "Content-Security-Policy", value: CSP },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "no-referrer" },
    ] }]
  },
}

export default nextConfig
