"use client"

import { ExternalLink } from "lucide-react"
import type { ApiErrorBody } from "@/lib/client"
import { cn } from "@/lib/cn"

/** An API error exactly as returned: message · code · hint · docs link. */
export function ApiError({ error, className }: { error: ApiErrorBody | null | undefined; className?: string }) {
  if (!error) return null
  return (
    <div role="alert" className={cn("border-destructive/40 bg-destructive/5 flex flex-col gap-1 rounded-lg border px-3 py-2 text-sm", className)}>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-destructive font-medium">{error.error}</span>
        {error.code && <code className="text-muted-foreground text-xs">{error.code}</code>}
        {error.status ? <span className="text-muted-foreground text-xs">HTTP {error.status}</span> : null}
      </div>
      {error.hint && <div className="text-muted-foreground">{error.hint}</div>}
      {error.docs && (
        <a href={error.docs} target="_blank" rel="noreferrer" className="text-foreground inline-flex items-center gap-1 text-xs underline underline-offset-4">
          {error.docs} <ExternalLink className="size-3" />
        </a>
      )}
    </div>
  )
}
