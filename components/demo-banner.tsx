"use client"

import { useEffect } from "react"
import { BANNER, DEMO, REPO_URL, startEngine } from "@/lib/browser/demo"

/**
 * Demo mode only: the permanent banner (where the keys live, backup first, clone the repo) above the top bar. It also
 * starts the browser engine as soon as any page opens, so timed sells resume and the visitor's key is made at once.
 */
export function DemoBanner() {
  useEffect(() => { startEngine() }, [])
  if (!DEMO) return null
  return (
    <div role="note" className="bg-amber-500/10 text-amber-800 dark:text-amber-300 border-b border-amber-500/30 px-5 py-1.5 text-center text-xs sm:px-6">
      {BANNER}{" "}
      <a className="font-medium underline underline-offset-4" href={REPO_URL} target="_blank" rel="noreferrer">Clone the repo</a> to run it on your own machine.
    </div>
  )
}
