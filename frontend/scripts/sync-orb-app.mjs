/**
 * Copy desktop/src → frontend/public/orb-app so mobile and PWA use the same
 * orb UI + logic as the Tauri desktop app (single source of truth).
 */
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const src = join(root, "desktop", "src");
const dest = join(root, "frontend", "public", "orb-app");

if (!existsSync(src)) {
  console.error("sync-orb-app: desktop/src not found at", src);
  process.exit(1);
}

if (existsSync(dest)) {
  rmSync(dest, { recursive: true, force: true });
}
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log("sync-orb-app: copied desktop/src → frontend/public/orb-app");
