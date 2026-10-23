import { Keypair } from "@solana/web3.js"
import { ok } from "@/lib/http"

export const dynamic = "force-dynamic"

/** GET /api/vanity/random → a preview of what a random mint looks like (Keypair.generate(); nothing is stored). */
export async function GET() {
  return ok({ publicKey: Keypair.generate().publicKey.toBase58(), note: "A launch with mint mode 'random' generates its own key and saves it to the pool as used." })
}
