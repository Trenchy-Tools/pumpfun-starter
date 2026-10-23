/** GET /api/trading/feed?mint=…: the live-trades stream under the name the shared Trading page uses (same handler as /api/trading/trades). */
export { GET } from "../trades/route"

export const dynamic = "force-dynamic"
