import * as React from "react"
import { cn } from "@/lib/cn"

const field =
  "border-input bg-transparent dark:bg-input/30 h-9 w-full min-w-0 rounded-md border px-3 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground"

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return <input data-slot="input" className={cn(field, className)} {...props} />
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea data-slot="textarea" className={cn(field, "h-auto min-h-20 py-2", className)} {...props} />
}

export function Select({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <select data-slot="select" className={cn(field, "appearance-none bg-[length:12px] bg-[position:right_0.6rem_center] bg-no-repeat pr-8", className)} style={{ backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%239a9aa2' stroke-width='2'><path d='m6 9 6 6 6-6'/></svg>\")" }} {...props}>
      {children}
    </select>
  )
}

/** A labelled control; `hint` sits under it in muted text. */
export function Field({ label, hint, className, children }: { label: React.ReactNode; hint?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <label className={cn("flex flex-col gap-1.5 text-sm", className)}>
      <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{label}</span>
      {children}
      {hint && <span className="text-muted-foreground text-xs">{hint}</span>}
    </label>
  )
}

export function Checkbox({ className, ...props }: React.ComponentProps<"input">) {
  return <input type="checkbox" className={cn("accent-foreground size-4 cursor-pointer rounded border", className)} {...props} />
}
