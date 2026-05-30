"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { getTimeGreeting, type GreetingPeriod, type TimeGreeting } from "@/lib/greeting";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

function useTimeGreeting(): TimeGreeting | null {
  const [greeting, setGreeting] = useState<TimeGreeting | null>(null);

  useEffect(() => {
    setGreeting(getTimeGreeting());
  }, []);

  return greeting;
}

function GreetingIcon({
  period,
  emoji,
  size = "sm",
}: {
  period: GreetingPeriod;
  emoji: string;
  size?: "sm" | "lg";
}) {
  return (
    <span
      className={`time-greeting-icon-wrap time-greeting-icon-wrap--${period} time-greeting-icon-wrap--${size}`}
      aria-hidden
    >
      {period === "morning" && (
        <>
          <span className="time-greeting-spark time-greeting-spark--a" />
          <span className="time-greeting-spark time-greeting-spark--b" />
          <span className="time-greeting-spark time-greeting-spark--c" />
        </>
      )}
      {period === "night" && (
        <>
          <span className="time-greeting-star time-greeting-star--a">✦</span>
          <span className="time-greeting-star time-greeting-star--b">✧</span>
        </>
      )}
      {period === "afternoon" && <span className="time-greeting-cloud-puff" />}
      {period === "evening" && <span className="time-greeting-evening-glow" />}

      <motion.span
        className="time-greeting-emoji-shell"
        initial={{ scale: 0, rotate: -24, opacity: 0 }}
        animate={{ scale: 1, rotate: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 460, damping: 13, mass: 0.7 }}
      >
        <span className={`time-greeting-emoji time-greeting-emoji--${period}`}>{emoji}</span>
      </motion.span>
    </span>
  );
}

export function TimeGreetingBadge() {
  const greeting = useTimeGreeting();

  if (!greeting) {
    return <div className="time-greeting-badge time-greeting-badge-skeleton" aria-hidden />;
  }

  return (
    <motion.div
      className="time-greeting-badge"
      initial={{ opacity: 0, y: 10, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.55, ease: EASE }}
    >
      <GreetingIcon period={greeting.period} emoji={greeting.emoji} size="sm" />
      <motion.span
        className="time-greeting-text"
        key={greeting.period}
        initial={{ opacity: 0, x: -6 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.45, ease: EASE }}
      >
        {greeting.label}
      </motion.span>
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
        <GreetingIcon period={greeting.period} emoji={greeting.emoji} size="sm" />
        {greeting.briefingLabel}
      </motion.p>
      <h1 className="dash-hero-title time-greeting-hero-title">
        <motion.span
          className="time-greeting-hero-phrase"
          key={`phrase-${greeting.period}`}
          initial={{ opacity: 0, y: 12, filter: "blur(6px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: 0.65, ease: EASE }}
        >
          {greeting.label},{" "}
        </motion.span>
        <motion.span
          className="time-greeting-hero-name"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, delay: 0.12, ease: EASE }}
        >
          {name}
        </motion.span>
        <GreetingIcon period={greeting.period} emoji={greeting.emoji} size="lg" />
      </h1>
    </>
  );
}

export function TimeGreetingCardTitle() {
  const greeting = useTimeGreeting();
  if (!greeting) return <>Your briefing, distilled</>;

  return (
    <motion.span
      key={greeting.period}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: EASE }}
    >
      {greeting.cardTitle}
    </motion.span>
  );
}
