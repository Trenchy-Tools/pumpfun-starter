import { redirect } from "next/navigation"

/** The home page is the Wallets page: nothing works until a funding wallet exists. */
export default function Home() {
  redirect("/wallets")
}
