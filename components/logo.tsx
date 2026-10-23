import { cn } from "@/lib/cn"

/** The TrenchyTools mark (apps/docs/apps/web/components/logo.tsx). */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn("size-5 shrink-0", className)}>
      <rect x="1" y="1" width="30" height="30" rx="8" className="fill-foreground" />
      <path d="M9 10h14v4h-5v9h-4v-9H9z" className="fill-background" />
    </svg>
  )
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      <LogoMark />
      TrenchyTools
      <span className="text-muted-foreground font-normal">pump.fun starter</span>
    </span>
  )
}
