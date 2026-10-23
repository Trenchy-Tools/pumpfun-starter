import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // self-contained server for the Dockerfile (node server.js)
  output: "standalone",
  // the live-trades websocket client runs in route handlers on Node; keep it out of the bundle
  serverExternalPackages: ["ws"],
}

export default nextConfig
