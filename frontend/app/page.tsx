import { Nav } from "@/components/landing/Nav";
import { Hero } from "@/components/landing/Hero";
import { WorkflowDemo } from "@/components/landing/WorkflowDemo";
import { Features } from "@/components/landing/Features";
import { Pricing } from "@/components/landing/Pricing";
import { CTA } from "@/components/landing/CTA";
import { Footer } from "@/components/landing/Footer";

export default function Home() {
  return (
    <>
      <Nav />
      <Hero />
      <WorkflowDemo />
      <Features />
      <Pricing />
      <CTA />
      <Footer />
    </>
  );
}
