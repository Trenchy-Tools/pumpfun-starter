"use client"

import * as React from "react"
import { AmountPills } from "@/components/amount-pills"
import { Button } from "@/components/ui/button"
import { Checkbox, Input } from "@/components/ui/input"
import { Mono } from "@/components/ui/table"
import { toast, toastFailure } from "@/components/ui/toast"
import { failureOf, post, walletsChanged } from "@/lib/api"
import { chain } from "@/lib/chain"

export type PickWallet = { publicKey: string; label: string }
/** A picked buyer: a wallet and its amount, as typed (a string, so the input can be edited freely). */
export type PickedBuyer = { publicKey: string; amount: string }

/** Lamport-sized sums without float dust. */
const sum = (xs: number[]) => Math.round(xs.reduce((s, x) => s + x, 0) * 1e9) / 1e9
const floor9 = (n: number) => Math.floor(n * 1e9) / 1e9

/**
 * "Pick buyers": a checkbox list of every wallet (balance shown), an amount input per picked wallet, "Set every amount
 * to" pills, `Split evenly [total]` and `+ create N new` (creates wallets into the folder and picks them). The same
 * control serves the bundle, the snipers and the holders of a launch.
 */
export function WalletPicker({ title, hint, wallets, balances, mainWallet, exclude, value, onChange, onWalletsChanged, max, disabled }: {
  title: React.ReactNode
  hint?: React.ReactNode
  wallets: PickWallet[]
  balances: Map<string, number>
  mainWallet: string | null
  /** wallets picked elsewhere (another group, the dev): shown greyed, not pickable here */
  exclude?: Set<string>
  value: PickedBuyer[]
  onChange: (next: PickedBuyer[]) => void
  /** after `+ create N new` wrote files: the parent reloads the list */
  onWalletsChanged?: () => void | Promise<void>
  max?: number
  disabled?: boolean
}) {
  const [newCount, setNewCount] = React.useState("2")
  const [creating, setCreating] = React.useState(false)
  const picked = new Map(value.map((b) => [b.publicKey, b.amount]))
  const total = sum(value.map((b) => Number(b.amount) || 0))
  const pickable = wallets.filter((w) => !exclude?.has(w.publicKey))
  const full = max !== undefined && value.length >= max

  const toggle = (pk: string) => {
    if (picked.has(pk)) onChange(value.filter((b) => b.publicKey !== pk))
    else if (!full) onChange([...value, { publicKey: pk, amount: chain.defaultBuy }])
  }
  const setAmount = (pk: string, amount: string) => onChange(value.map((b) => (b.publicKey === pk ? { ...b, amount } : b)))
  const every = (amount: string) => onChange(value.map((b) => ({ ...b, amount })))
  const split = (t: number) => { if (value.length) every(String(floor9(t / value.length))) }
  const all = () => onChange([...value, ...pickable.filter((w) => !picked.has(w.publicKey)).slice(0, max === undefined ? undefined : Math.max(0, max - value.length)).map((w) => ({ publicKey: w.publicKey, amount: chain.defaultBuy }))])

  const createNew = async () => {
    const n = Math.max(1, Math.min(100, Math.floor(Number(newCount)) || 1))
    setCreating(true)
    try {
      const r = await post<{ dir: string; wallets: Array<{ publicKey: string; label: string; path: string }> }>("/api/wallets", { count: n })
      await onWalletsChanged?.()
      walletsChanged()
      onChange([...value, ...r.wallets.slice(0, max === undefined ? undefined : Math.max(0, max - value.length)).map((w) => ({ publicKey: w.publicKey, amount: chain.defaultBuy }))])
      toast({ tone: "ok", title: `${r.wallets.length} new wallet${r.wallets.length === 1 ? "" : "s"} picked`, detail: <>Keys saved to <span className="font-mono text-xs break-all">{r.dir}</span></> })
    } catch (e) {
      toastFailure(failureOf(e), "Could not create wallets")
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-muted-foreground text-xs">{value.length} picked{max !== undefined ? ` / ${max}` : ""} · {total} {chain.symbol}</span>
        {hint ? <span className="text-muted-foreground text-xs">{hint}</span> : null}
        <span className="ml-auto flex items-center gap-1 text-xs">
          <button type="button" className="text-muted-foreground hover:text-foreground underline-offset-4 hover:underline" onClick={all} disabled={disabled || full}>all</button>
          <span className="text-muted-foreground">·</span>
          <button type="button" className="text-muted-foreground hover:text-foreground underline-offset-4 hover:underline" onClick={() => onChange([])} disabled={disabled || !value.length}>none</button>
        </span>
      </div>
      <div className="max-h-64 overflow-y-auto rounded-md border">
        {wallets.length === 0 ? <div className="text-muted-foreground px-3 py-4 text-center text-sm">No wallets yet. Create some with the button below.</div> : null}
        {wallets.map((w) => {
          const on = picked.has(w.publicKey)
          const excluded = !on && exclude?.has(w.publicKey)
          return (
            <label key={w.publicKey} className={`flex items-center gap-2 border-b px-2 py-1 text-sm last:border-0 ${on ? "bg-muted/60" : "hover:bg-muted/30"} ${excluded ? "opacity-40" : ""}`}>
              <Checkbox checked={on} disabled={disabled || excluded || (!on && full)} onChange={() => toggle(w.publicKey)} />
              <span className="w-5 text-center text-xs">{w.publicKey === mainWallet ? "★" : ""}</span>
              <span className="min-w-0 flex-1 truncate">{w.label}</span>
              <Mono className="text-muted-foreground hidden text-xs sm:inline">{chain.short(w.publicKey)}</Mono>
              <span className="w-28 text-right font-mono text-xs">{chain.fmt(balances.get(w.publicKey))} {chain.symbol}</span>
              <span className="w-28">
                {on ? <Input inputMode="decimal" value={picked.get(w.publicKey) ?? ""} onChange={(e) => setAmount(w.publicKey, e.target.value)} className="h-7 px-2 font-mono text-xs" aria-label={`${w.label} amount`} /> : null}
              </span>
            </label>
          )
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <AmountPills values={chain.pills} symbol={chain.symbol} onEvery={every} onSplit={split} disabled={disabled || !value.length} />
        <span className="inline-flex items-center gap-1 text-xs">
          <Button size="xs" variant="outline" onClick={() => void createNew()} disabled={disabled || creating || full}>{creating ? "Writing files…" : "+ create"}</Button>
          <Input inputMode="numeric" value={newCount} onChange={(e) => setNewCount(e.target.value)} className="h-6 w-12 px-2 text-center font-mono text-xs" aria-label="How many new wallets" />
          <span className="text-muted-foreground">new</span>
        </span>
      </div>
    </div>
  )
}
