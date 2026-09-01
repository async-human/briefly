export function detectorLabel(kind: string | null | undefined): string | null {
  if (kind === "pricing_positioning") return "Pricing / positioning";
  if (kind === "model_api") return "Model / API";
  if (kind === "product_release") return "Product release";
  return null;
}

export const SIGNAL_RATE_OPTIONS: { label: string; value: string; note?: string }[] = [
  { label: "Useful", value: "useful" },
  { label: "Already knew", value: "irrelevant", note: "already_knew" },
  { label: "No impact", value: "irrelevant", note: "no_impact" },
  { label: "Wrong", value: "incorrect" },
];
