"use client"

import { cn } from "@/lib/cn"

/** An on/off switch. */
export function Toggle({ checked, onChange, label, className }: { checked: boolean; onChange: (v: boolean) => void; label?: React.ReactNode; className?: string }) {
  return (
    <label className={cn("inline-flex cursor-pointer items-center gap-2 text-sm", className)}>
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className={cn("relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors", checked ? "bg-foreground border-foreground" : "bg-muted border-input")}>
        <span className={cn("bg-background size-4 rounded-full shadow-xs transition-transform", checked ? "translate-x-4" : "translate-x-0.5")} />
      </button>
      {label}
    </label>
  )
}
