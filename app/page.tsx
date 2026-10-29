import { redirect } from "next/navigation"

/** The home page is the Launch page; it says what is missing (a ★ wallet, an image) on its button. */
export default function Home() {
  redirect("/launch")
}
