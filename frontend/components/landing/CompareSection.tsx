"use client";

import { useId, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Reveal } from "./Reveal";
import { CompareQuadrant } from "./CompareQuadrant";
import { CompareFullTable } from "./CompareFullTable";
import { StaggerHeadline } from "./StaggerHeadline";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

const VERDICTS = [
  {
    title: "vs Meco",
    themLabel: "Meco",
    themBody:
      "if you enjoy reading every newsletter and just want them out of your inbox.",
    usBody:
      "if 30 newsletters a day is the problem — you want the five that matter, already connected to your work.",
  },
  {
    title: "vs Readwise Reader",
    themLabel: "Reader",
    themBody:
      "if you read deeply, annotate, and export highlights. The best library there is.",
    usBody:
      "if your saved-for-later list keeps growing and the goal is staying sharp, not archiving.",
  },
  {
    title: "vs Readless",
    themLabel: "Readless",
    themBody: "if you want the cheapest way to compress newsletters into one summary email.",
    usBody:
      "if you want a brief that knows you — tracks stories over weeks and answers questions about what you've read.",
  },
  {
    title: "vs ChatGPT Pulse",
    themLabel: "Pulse",
    themBody:
      "if you live in ChatGPT and want general suggestions from your chats and the open web.",
    usBody:
      "if your edge is a curated diet. Pulse briefs you on the world — Briefly briefs you on your world.",
  },
] as const;

export function CompareSection() {
  const [tableOpen, setTableOpen] = useState(false);
  const panelId = useId();
  const reducedMotion = useReducedMotion();

  return (
    <section className="compare-section landing-section landing-band-cool" id="compare">
      <div className="landing-section-inner compare-inner">
        <Reveal>
          <div className="section-header-centered compare-header">
            <p className="section-eyebrow">How Briefly compares</p>
            <StaggerHeadline
              as="h2"
              trigger="inView"
              className="section-heading"
              text={"Plenty of apps organize your reading.\nOne actually does it for you — and learns."}
            />
            <p className="section-body compare-lede">
              An honest comparison. Some of these tools are excellent at a different job —
              here&apos;s where each one fits on the map, and where Briefly is the only option.
            </p>
          </div>
        </Reveal>

        <Reveal delay={0.06}>
          <CompareQuadrant />
        </Reveal>

        <div className="compare-table-disclosure">
          <button
            type="button"
            className="compare-table-toggle"
            aria-expanded={tableOpen}
            aria-controls={panelId}
            onClick={() => setTableOpen((open) => !open)}
          >
            <span>{tableOpen ? "Hide full comparison" : "See full comparison"}</span>
            <motion.span
              className="compare-table-toggle-icon"
              aria-hidden
              animate={{ rotate: tableOpen ? 180 : 0 }}
              transition={{ duration: reducedMotion ? 0.01 : 0.28, ease: EASE }}
            >
              ▾
            </motion.span>
          </button>

          <AnimatePresence initial={false}>
            {tableOpen && (
              <motion.div
                id={panelId}
                className="compare-table-panel"
                initial={reducedMotion ? false : { height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={reducedMotion ? undefined : { height: 0, opacity: 0 }}
                transition={{ duration: reducedMotion ? 0.01 : 0.38, ease: EASE }}
              >
                <div className="compare-table-panel-inner">
                  <CompareFullTable />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="compare-verdicts">
          {VERDICTS.map((v, i) => (
            <Reveal key={v.title} delay={0.06 + i * 0.05}>
              <article className="compare-verdict">
                <h3 className="compare-verdict-title">{v.title}</h3>
                <p className="compare-verdict-them">
                  <b>Choose {v.themLabel}</b> {v.themBody}
                </p>
                <p className="compare-verdict-us">
                  <b>Choose Briefly</b> {v.usBody}
                </p>
              </article>
            </Reveal>
          ))}
        </div>

        <Reveal delay={0.12}>
          <p className="compare-foot">
            Based on public documentation and pricing as of June 2026. All product names and
            trademarks belong to their respective owners.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
