/** URL for the standalone mobile orb (one-tap voice app). */
export function mobileOrbAppUrl(): string {
  const app =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.NEXT_PUBLIC_DASHBOARD_URL ??
    "https://www.sendbriefly.app";
  return `${app.replace(/\/$/, "")}/orb`;
}
