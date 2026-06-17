import { LandingPageShell } from "@/components/landing/LandingPageShell";
import { ScrollProgress } from "@/components/landing/ScrollProgress";
import { Nav } from "@/components/landing/Nav";
import { Hero } from "@/components/landing/Hero";
import { LiveDemo } from "@/components/landing/LiveDemo";
import { MemoryDemo } from "@/components/landing/MemoryDemo";
import { TrustSourcesSection } from "@/components/landing/TrustSourcesSection";
import { Features } from "@/components/landing/Features";
import { CompareSection } from "@/components/landing/CompareSection";
import { Pricing } from "@/components/landing/Pricing";
import { CTA } from "@/components/landing/CTA";
import { Footer } from "@/components/landing/Footer";

export default function Home() {
  return (
    <LandingPageShell>
      <ScrollProgress />
      <Nav />
      <Hero />
      <LiveDemo />
      <MemoryDemo />
      <TrustSourcesSection />
      <Features />
      <CompareSection />
      <Pricing />
      <CTA />
      <Footer />
    </LandingPageShell>
  );
}
