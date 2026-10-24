import { fail, ok } from "@/lib/http"
import { trenchy } from "@/lib/settings"

/** POST /api/ipfs (multipart: file, name, symbol, description, twitter, telegram, website) → passed straight to the API's POST /api/ipfs → { metadataUri }. */
export async function POST(req: Request) {
  try {
    const form = await req.formData()
    if (!(form.get("file") instanceof Blob)) return fail(new Error("file (png / jpg / gif / webp, up to 4 MB) is required"), 400)
    if (!form.get("name") || !form.get("symbol")) return fail(new Error("name and symbol are required"), 400)
    if (!form.has("showName")) form.set("showName", "true")
    return ok(await trenchy().uploadMetadata(form))
  } catch (e) {
    return fail(e)
  }
}
