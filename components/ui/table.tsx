import * as React from "react"
import { cn } from "@/lib/cn"

export function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div className="w-full overflow-x-auto rounded-lg border">
      <table className={cn("w-full caption-bottom text-sm", className)} {...props} />
    </div>
  )
}
export function THead({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead className={cn("bg-muted/60 [&_tr]:border-b", className)} {...props} />
}
export function TBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody className={cn("[&_tr:last-child]:border-0", className)} {...props} />
}
export function TR({ className, ...props }: React.ComponentProps<"tr">) {
  return <tr className={cn("hover:bg-muted/40 data-[selected=true]:bg-muted/60 border-b transition-colors", className)} {...props} />
}
export function TH({ className, ...props }: React.ComponentProps<"th">) {
  return <th className={cn("text-muted-foreground h-9 px-3 text-left align-middle text-xs font-medium tracking-wide uppercase whitespace-nowrap", className)} {...props} />
}
export function TD({ className, ...props }: React.ComponentProps<"td">) {
  return <td className={cn("px-3 py-2 align-middle whitespace-nowrap", className)} {...props} />
}
export function Mono({ className, ...props }: React.ComponentProps<"span">) {
  return <span className={cn("font-mono text-[13px]", className)} {...props} />
}
