"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { DaymarkIcon } from "@/components/DaymarkIcon";
import { getTimeGreeting, type TimeGreeting } from "@/lib/greeting";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

function useTimeGreeting(): TimeGreeting | null {
  const [greeting, setGreeting] = useState<TimeGreeting | null>(null);

  useEffect(() => {
    setGreeting(getTimeGreeting());
  }, []);

  return greeting;
}

export function TimeGreetingBadge() {
  const greeting = useTimeGreeting();

  if (!greeting) {
    return <div className="time-greeting-badge time-greeting-badge-skeleton" aria-hidden />;
  }

  return (
    <motion.div
      className="time-greeting-badge"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: EASE }}
    >
      <DaymarkIcon period={greeting.period} size="md" />
      <span className="time-greeting-text">{greeting.label}</span>
    </motion.div>
  );
}

export function TimeGreetingHero({ name }: { name: string }) {
  const greeting = useTimeGreeting();

  if (!greeting) {
    return (
      <>
        <p className="dash-hero-label">Your briefing</p>
        <h1 className="dash-hero-title">Welcome back, {name}</h1>
      </>
    );
  }

  return (
    <>
      <motion.p
        className="dash-hero-label time-greeting-hero-label"
        key={`label-${greeting.period}`}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: EASE }}
      >
        {greeting.briefingLabel}
      </motion.p>
      <div className="time-greeting-hero-head">
        <motion.div
          key={`mark-${greeting.period}`}
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, ease: EASE }}
        >
          <DaymarkIcon period={greeting.period} size="lg" />
        </motion.div>
        <h1 className="dash-hero-title time-greeting-hero-title">
          <motion.span
            className="time-greeting-hero-phrase"
            key={`phrase-${greeting.period}`}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, ease: EASE }}
          >
            {greeting.label},{" "}
          </motion.span>
          <motion.span
            className="time-greeting-hero-name"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.08, ease: EASE }}
          >
            {name}
          </motion.span>
        </h1>
      </div>
    </>
  );
}

export function TimeGreetingCardTitle() {
  const greeting = useTimeGreeting();
  if (!greeting) return <>Your briefing, distilled</>;

  return (
    <motion.span
      key={greeting.period}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: EASE }}
    >
      {greeting.cardTitle}
    </motion.span>
  );
}
