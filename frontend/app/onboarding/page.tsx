import { Suspense } from "react";
import OnboardingPage from "./OnboardingClient";

export default function Page() {
  return (
    <Suspense>
      <OnboardingPage />
    </Suspense>
  );
}
