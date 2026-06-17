"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Reveal } from "./Reveal";
import { SourceIcon } from "@/components/SourceIcon";
import { StaggerHeadline } from "./StaggerHeadline";
import { SourcesStrip } from "./SourcesStrip";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

const SOURCE_ACCESS = [
  {
    type: "gmail",
    name: "Gmail",
    scope: "Newsletters you approve",
    detail:
      "A metadata-only scan finds newsletter senders. Full content is fetched only from senders you pick. Personal mail never enters Briefly.",
    never: "Personal email, attachments, contacts",
  },
  {
    type: "youtube",
    name: "YouTube",
    scope: "Channels you subscribe to",
    detail: "Public videos and metadata from subscriptions you already follow — scoped to channels, not your entire Google account.",
    never: "Private videos, watch history, comments",
  },
  {
    type: "reddit",
    name: "Reddit",
    scope: "Subreddits you follow",
    detail: "Posts from communities you subscribe to. You choose what gets added to your briefing pool.",
    never: "Private messages, account-wide history",
  },
  {
    type: "rss",
    name: "RSS & URLs",
    scope: "Feeds and links you add",
    detail: "Only the blogs, newsletters, and pages you explicitly connect — no crawling beyond what you point us at.",
    never: "Browsing outside your sources",
  },
] as const;

export function TrustSourcesSection() {
  return (
    <section className="trust-sources-section landing-section landing-band-base" id="trust">
      <div className="landing-section-inner trust-sources-inner">
        <SourcesStrip />

        <Reveal>
          <div className="section-header-centered">
            <p className="section-eyebrow">Your data, your rules</p>
            <StaggerHeadline
              as="h2"
              trigger="inView"
              className="section-heading"
              text={"We don't read everything you connect.\nWe read what you choose."}
            />
            <p className="section-body">
              Briefly only ingests content from sources you approve — newsletters, feeds, channels,
              and communities. Disconnect anytime; we revoke access and delete what we stored.
            </p>
          </div>
        </Reveal>

        <div className="trust-sources-grid">
          {SOURCE_ACCESS.map((item, i) => (
            <motion.article
              key={item.name}
              className="trust-source-card"
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ duration: 0.4, delay: Math.min(i * 0.06, 0.24), ease: EASE }}
            >
              <div className="trust-source-head">
                <span className="trust-source-icon" aria-hidden>
                  <SourceIcon type={item.type} name={item.name} size={20} />
                </span>
                <div>
                  <h3 className="trust-source-name">{item.name}</h3>
                  <p className="trust-source-scope">{item.scope}</p>
                </div>
              </div>
              <p className="trust-source-detail">{item.detail}</p>
              <p className="trust-source-never">
                <span className="trust-source-never-label">Never accessed</span>
                {item.never}
              </p>
            </motion.article>
          ))}
        </div>

        <Reveal delay={0.1}>
          <div className="trust-sources-foot">
            <p className="trust-sources-alt">
              <strong>No Gmail?</strong> Forward newsletters to your private Briefly address — same
              briefings, zero inbox access.
            </p>
            <div className="trust-sources-links">
              <Link href="/privacy/data-handling" className="trust-sources-link">
                How we handle your email →
              </Link>
              <Link href="/privacy" className="trust-sources-link trust-sources-link-muted">
                Privacy policy
              </Link>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
