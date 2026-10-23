import { AlertTriangle } from "lucide-react"
import type { Failure } from "@/lib/api"

/** An API error exactly as returned: message · code · HTTP status · hint · docs link · folder. */
export function FailureBox({ failure, className = "" }: { failure: Failure | null | undefined; className?: string }) {
  if (!failure) return null
  return (
    <div role="alert" className={`border-destructive/40 bg-destructive/5 flex gap-3 rounded-lg border p-3 text-sm ${className}`}>
      <AlertTriangle className="text-destructive mt-0.5 size-4 shrink-0" />
      <div className="flex min-w-0 flex-col gap-1">
        <p className="break-words">{failure.error}</p>
        <p className="text-muted-foreground flex flex-wrap gap-x-3 text-xs">
          {failure.code ? <code>{failure.code}</code> : null}
          {failure.status ? <span>HTTP {failure.status}</span> : null}
          {failure.hint ? <span>{failure.hint}</span> : null}
          {failure.docs ? <a className="underline underline-offset-4" href={failure.docs} target="_blank" rel="noreferrer">docs</a> : null}
          {failure.dir ? <span className="font-mono break-all">{failure.dir}</span> : null}
        </p>
      </div>
    </div>
  )
}
