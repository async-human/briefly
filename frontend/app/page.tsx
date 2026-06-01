import { LandingPageShell } from "@/components/landing/LandingPageShell";
import { Nav } from "@/components/landing/Nav";
import { Hero } from "@/components/landing/Hero";
import { LiveDemo } from "@/components/landing/LiveDemo";
import { ProofTicker } from "@/components/landing/ProofTicker";
import { SourcesStrip } from "@/components/landing/SourcesStrip";
import { PrinciplesSection } from "@/components/landing/PrinciplesSection";
import { Features } from "@/components/landing/Features";
import { Roadmap } from "@/components/landing/Roadmap";
import { Pricing } from "@/components/landing/Pricing";
import { CTA } from "@/components/landing/CTA";
import { Footer } from "@/components/landing/Footer";

export default function Home() {
  return (
    <LandingPageShell>
      <Nav />
      <Hero />
      <LiveDemo />
      <ProofTicker />
      <SourcesStrip />
      <PrinciplesSection />
      <Features />
      <Roadmap />
      <Pricing />
      <CTA />
      <Footer />
    </LandingPageShell>
  );
}
