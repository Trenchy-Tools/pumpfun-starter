import * as React from "react"
import { cn } from "@/lib/cn"

/** A small status chip for the top bar and tables. */
export function Pill({ tone = "muted", className, children, ...props }: React.ComponentProps<"span"> & { tone?: "muted" | "ok" | "warn" | "error" }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium whitespace-nowrap",
        tone === "ok" && "border-ok/40 text-ok",
        tone === "warn" && "border-warn/40 text-warn",
        tone === "error" && "border-destructive/40 text-destructive",
        tone === "muted" && "text-muted-foreground",
        className
      )}
      {...props}
    >
      {children}
    </span>
  )
}

export function Dot({ tone }: { tone: "ok" | "warn" | "error" | "muted" }) {
  return <span className={cn("size-1.5 rounded-full", tone === "ok" && "bg-ok", tone === "warn" && "bg-warn", tone === "error" && "bg-destructive", tone === "muted" && "bg-muted-foreground")} />
}
