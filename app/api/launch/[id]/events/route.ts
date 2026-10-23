import { sse } from "@/lib/http"
import { eventsOf, readLaunches, subscribe } from "@/lib/launch"

export const dynamic = "force-dynamic"

/** GET /api/launch/:id/events → server-sent events: the log so far, then every new stage until done / error. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return sse(req, (send, close) => {
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
    return subscribe(id, (e) => { send(e); if (finished(e.stage)) close() })
  })
}
