"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { getTimeGreeting, type TimeGreeting } from "@/lib/greeting";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

function useTimeGreeting(): TimeGreeting | null {
  const [greeting, setGreeting] = useState<TimeGreeting | null>(null);
  useEffect(() => { setGreeting(getTimeGreeting()); }, []);
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

  // Split greeting phrase into words so each can stagger in independently
  const words = greeting.label.split(" ");

  return (
    <>
      <motion.p
        className="dash-hero-label"
        key={`label-${greeting.period}`}
        initial={{ opacity: 0, y: 5 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: EASE }}
      >
        {greeting.briefingLabel}
      </motion.p>

      <h1 className="dash-hero-title tg-hero-title">
        {/* Greeting phrase — each word staggers in with period-specific colour */}
        <span className={`tg-phrase tg-phrase--${greeting.period}`} aria-hidden>
          {words.map((word, i) => (
            <motion.span
              key={`${greeting.period}-${i}`}
              className="tg-word"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: i * 0.08, ease: EASE }}
            >
              {word}
            </motion.span>
          ))}
          <span className="tg-comma" aria-hidden>,</span>
        </span>
        {/* Screen-reader-only accessible version */}
        <span className="sr-only">{greeting.label},</span>

        {/* Name fades in after the phrase */}
        <motion.span
          className="tg-name"
          key={`name-${greeting.period}`}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: words.length * 0.08 + 0.04, ease: EASE }}
        >
          {name}
        </motion.span>
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
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: EASE }}
    >
      {greeting.cardTitle}
    </motion.span>
  );
}
