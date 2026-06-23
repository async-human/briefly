import { redirect } from "next/navigation";

/** Entry point for mobile / PWA — serves the same bundle as the desktop Tauri orb. */
export default function OrbEntryPage() {
  redirect("/orb-app/index.html");
}
