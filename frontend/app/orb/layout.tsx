import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Briefly Orb — Talk to your briefing",
  description: "One tap to speak with Briefly. Your voice assistant for news, meetings, and daily briefings.",
  appleWebApp: {
    capable: true,
    title: "Briefly Orb",
    statusBarStyle: "black-translucent",
  },
};

export default function OrbLayout({ children }: { children: React.ReactNode }) {
  return children;
}
