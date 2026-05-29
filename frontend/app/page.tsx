import { Nav } from "@/components/landing/Nav";
import { Hero } from "@/components/landing/Hero";
import { ProofTicker } from "@/components/landing/ProofTicker";
import { WorkflowDemo } from "@/components/landing/WorkflowDemo";
import { CompareSection } from "@/components/landing/CompareSection";
import { Features } from "@/components/landing/Features";
import { Pricing } from "@/components/landing/Pricing";
import { CTA } from "@/components/landing/CTA";
import { Footer } from "@/components/landing/Footer";

export default function Home() {
  return (
    <>
      <Nav />
      <Hero />
      <ProofTicker />
      <WorkflowDemo />
      <CompareSection />
      <Features />
      <Pricing />
      <CTA />
      <Footer />
    </>
  );
}
