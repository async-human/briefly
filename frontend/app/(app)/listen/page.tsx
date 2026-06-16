import { redirect } from "next/navigation";

// /listen is retired. The dashboard voice orb is now the single Briefly
// assistant (voice + text + read-aloud), so any old links or PWA entrypoints
// that pointed here are sent to the dashboard where the orb lives.
export default function ListenRedirect() {
  redirect("/dashboard");
}
