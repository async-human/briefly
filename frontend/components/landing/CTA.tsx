"use client";

import { useState } from "react";
import { Reveal } from "./Reveal";

export function CTA() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState(false);

  function handleSignup() {
    const trimmed = email.trim();
    if (!trimmed || !trimmed.includes("@")) {
      setError(true);
      setTimeout(() => setError(false), 1000);
      return;
    }
    setSubmitted(true);
  }

  return (
    <section className="cta-section" id="waitlist">
      <div className="cta-inner">
        <Reveal>
          <h2 className="cta-title">Start tomorrow morning</h2>
        </Reveal>
        <Reveal delay={0.1}>
          <p className="cta-sub">
            Join the waitlist. Connect your sources tonight, read your first briefing tomorrow.
          </p>
        </Reveal>
        <Reveal delay={0.15}>
          <div className="email-form">
            <input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitted}
              style={error ? { color: "#c44" } : undefined}
              onKeyDown={(e) => e.key === "Enter" && handleSignup()}
            />
            <button onClick={handleSignup} disabled={submitted}>
              {submitted ? "You're on the list" : "Join waitlist"}
            </button>
          </div>
        </Reveal>
        <Reveal delay={0.2}>
          <p className="form-note">No credit card required</p>
        </Reveal>
      </div>
    </section>
  );
}
