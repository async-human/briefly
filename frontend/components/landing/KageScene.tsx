"use client";

import { KageLandingPage } from "@designcodeio/threeui/components/KageLandingPage";
import "@designcodeio/threeui/style.css";
import "@/styles/kage-scene.css";

export function Scene() {
  return (
    <div className="shader-frame">
      <KageLandingPage
        headingFont="onest"
        bodyFont="onest"
        headingWeight="400"
        bodyWeight="300"
        primaryColor="#c49a3c"
        headingSize={46}
        bodySize={17}
        headingLetterSpacing={-0.012}
      />
    </div>
  );
}
