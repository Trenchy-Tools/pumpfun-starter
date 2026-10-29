import type { Metadata } from "next"
import { IBM_Plex_Mono, Space_Grotesk } from "next/font/google"
import { DemoBanner } from "@/components/demo-banner"
import { Providers } from "@/components/providers"
import { TopBar } from "@/components/top-bar"
import { Toaster } from "@/components/ui/toast"
import "./globals.css"

const sans = Space_Grotesk({ subsets: ["latin"], variable: "--font-space-grotesk" })
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-ibm-plex-mono" })

export const metadata: Metadata = {
  title: { default: "pump.fun starter · TrenchyTools", template: "%s · pump.fun starter" },
  description: process.env.NEXT_PUBLIC_DEMO === "1" ? "Launch, bundle and trade pump.fun coins on the TrenchyTools API, from your browser. Your keys stay in this browser." : "Launch, bundle and trade pump.fun coins on the TrenchyTools API. Keys stay in files inside the repo.",
  icons: { icon: "/icon.svg" },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${sans.variable} ${mono.variable}`}>
      <body className="bg-background text-foreground min-h-dvh font-sans antialiased">
        <Providers>
          <DemoBanner />
          <TopBar />
          <main className="mx-auto w-full max-w-6xl px-5 py-6 sm:px-6">{children}</main>
          <Toaster />
        </Providers>
      </body>
    </html>
  )
}
