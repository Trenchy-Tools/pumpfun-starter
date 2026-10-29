import type { Metadata } from "next"
import { IBM_Plex_Mono, Space_Grotesk } from "next/font/google"
import { DemoBanner } from "@/components/demo-banner"
import { Providers } from "@/components/providers"
import { TopBar } from "@/components/top-bar"
import { Toaster } from "@/components/ui/toast"
import "./globals.css"

const sans = Space_Grotesk({ subsets: ["latin"], variable: "--font-space-grotesk" })
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-ibm-plex-mono" })

const DESCRIPTION = process.env.NEXT_PUBLIC_DEMO === "1" ? "Launch, bundle and trade pump.fun coins on the TrenchyTools API, from your browser." : "Launch, bundle and trade pump.fun coins on the TrenchyTools API."
export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://pumpfun.trenchy.tools"),
  openGraph: { type: "website", siteName: "TrenchyTools", title: "pump.fun launcher · TrenchyTools", description: DESCRIPTION, images: [{ url: "/og.png", width: 1280, height: 640, alt: "pump.fun launcher on the TrenchyTools API" }] },
  twitter: { card: "summary_large_image", site: "@trenchytools", title: "pump.fun launcher · TrenchyTools", description: DESCRIPTION, images: ["/og.png"] },
  title: { default: "pump.fun starter · TrenchyTools", template: "%s · pump.fun starter" },
  description: process.env.NEXT_PUBLIC_DEMO === "1" ? "Launch, bundle and trade pump.fun coins on the TrenchyTools API, from your browser." : "Launch, bundle and trade pump.fun coins on the TrenchyTools API.",
  icons: { icon: "/icon.svg" },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${sans.variable} ${mono.variable}`}>
      <body className="bg-background text-foreground min-h-dvh font-sans antialiased">
        <Providers>
          <TopBar />
          <DemoBanner />
          <main className="mx-auto w-full max-w-6xl px-5 py-6 sm:px-6">{children}</main>
          <Toaster />
        </Providers>
      </body>
    </html>
  )
}
