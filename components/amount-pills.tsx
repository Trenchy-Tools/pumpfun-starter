"use client"

import * as React from "react"
import { Input } from "@/components/ui/input"

/** A small round button, the launcher's "pill-btn". */
export function PillButton({ className = "", ...props }: React.ComponentProps<"button">) {
  return <button type="button" className={`hover:bg-accent inline-flex h-6 items-center rounded-full border px-2.5 font-mono text-xs transition-colors disabled:opacity-50 ${className}`} {...props} />
}

/**
 * The launcher's amount tools: "Set every amount to" pills, `Split evenly [total]` and, when given, `Max all`.
 * Every handler sets the amount on each row the caller owns; the component holds only the split total.
 */
export function AmountPills({ values, symbol, onEvery, onSplit, onMax, disabled, className = "" }: { values: string[]; symbol: string; onEvery: (value: string) => void; onSplit?: (total: number) => void; onMax?: () => void; disabled?: boolean; className?: string }) {
  const [total, setTotal] = React.useState("")
  const split = () => { const t = Number(total); if (t > 0 && onSplit) onSplit(t) }
  return (
    <div className={`flex flex-wrap items-center gap-1.5 text-xs ${className}`}>
      <span className="text-muted-foreground">Set every amount to</span>
      {values.map((v) => <PillButton key={v} disabled={disabled} onClick={() => onEvery(v)}>{v}</PillButton>)}
      {onSplit ? (
        <span className="ml-2 inline-flex items-center gap-1">
          <PillButton disabled={disabled || !(Number(total) > 0)} onClick={split}>Split evenly</PillButton>
          <Input inputMode="decimal" placeholder={`total ${symbol}`} value={total} onChange={(e) => setTotal(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") split() }} className="h-6 w-24 px-2 font-mono text-xs" />
        </span>
      ) : null}
      {onMax ? <PillButton disabled={disabled} onClick={onMax}>Max all</PillButton> : null}
    </div>
  )
}
