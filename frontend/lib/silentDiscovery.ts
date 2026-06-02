import { api } from "@/lib/api";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Run source discovery and auto-confirm selected candidates without user review.
 */
export async function runSilentSourceDiscovery(): Promise<void> {
  await api.runSourceDiscovery();

  for (let i = 0; i < 180; i++) {
    await sleep(700);
    const status = await api.getDiscoveryStatus();
    const progress = status.meta?.progress?.status;
    if (progress === "complete" || progress === "error") {
      const ids = status.candidates.filter((c) => c.selected).map((c) => c.id);
      await api.confirmSourceDiscovery(ids);
      return;
    }
    if (status.candidates.length > 0 && progress !== "running") {
      const ids = status.candidates.filter((c) => c.selected).map((c) => c.id);
      await api.confirmSourceDiscovery(ids);
      return;
    }
  }

  const final = await api.getDiscoveryStatus();
  const ids = final.candidates.filter((c) => c.selected).map((c) => c.id);
  await api.confirmSourceDiscovery(ids);
}
