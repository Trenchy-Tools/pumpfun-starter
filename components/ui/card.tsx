import * as React from "react"
import { cn } from "@/lib/cn"

export function Card({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card" className={cn("bg-card text-card-foreground flex flex-col gap-4 rounded-xl border p-5 shadow-xs", className)} {...props} />
}

export function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-1", className)} {...props} />
}

export function CardTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return <h2 className={cn("text-base leading-none font-semibold tracking-tight", className)} {...props} />
}

export function CardDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("text-muted-foreground text-sm", className)} {...props} />
}

export function Pill({ className, tone = "muted", ...props }: React.ComponentProps<"span"> & { tone?: "muted" | "ok" | "warn" | "bad" }) {
  const tones = {
    muted: "bg-muted text-muted-foreground",
    ok: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    warn: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    bad: "bg-destructive/10 text-destructive",
  }
  return <span className={cn("inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium whitespace-nowrap", tones[tone], className)} {...props} />
}
