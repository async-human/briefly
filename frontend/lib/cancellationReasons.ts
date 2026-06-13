/** Churn reasons — aligned with Dodo Payments CancellationFeedback enum. */
export const CANCELLATION_REASONS = [
  { value: "too_expensive", label: "It's too expensive" },
  { value: "unused", label: "I don't use it enough" },
  { value: "missing_features", label: "Missing features I need" },
  { value: "switched_service", label: "I switched to another service" },
  { value: "low_quality", label: "Briefings weren't useful enough" },
  { value: "too_complex", label: "It felt too complicated" },
  { value: "customer_service", label: "Support didn't meet my expectations" },
  { value: "other", label: "Other reason" },
] as const;

export type CancellationReason = (typeof CANCELLATION_REASONS)[number]["value"];
