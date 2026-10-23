"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import { XIcon } from "lucide-react"
import { cn } from "@/lib/cn"

/** A right-hand side panel (the docs' Sheet, without Radix): overlay, Escape closes, focus stays inside. */
export function Sheet({ open, onClose, title, description, children, className }: { open: boolean; onClose: () => void; title: React.ReactNode; description?: React.ReactNode; children: React.ReactNode; className?: string }) {
  React.useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    document.addEventListener("keydown", onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev }
  }, [open, onClose])
  if (!open || typeof document === "undefined") return null
  // a portal onto <body>: the top bar's backdrop blur would otherwise trap this fixed panel inside the bar's box
  return createPortal(
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className={cn("bg-background absolute inset-y-0 right-0 flex h-full w-full flex-col gap-4 border-l p-5 shadow-lg sm:max-w-md", className)}>
        <div className="flex flex-col gap-1.5 pr-8">
          <h2 className="text-foreground font-semibold">{title}</h2>
          {description && <p className="text-muted-foreground text-sm">{description}</p>}
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="ring-offset-background focus:ring-ring absolute top-5 right-5 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden">
          <XIcon className="size-4" />
        </button>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
