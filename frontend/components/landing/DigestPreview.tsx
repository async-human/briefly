"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { ArrowDownIcon } from "./icons";

const digestItems = [
  {
    id: "item1",
    source: "The Rundown AI",
    tag: "new" as const,
    headline:
      "Anthropic's Claude 4 shows 40% improvement on agentic tasks — benchmarks suggest tool use is finally reliable",
    why: (
      <>
        As someone building an <strong>agent-based product</strong>, this directly affects how much you can trust multi-step tool calls without human review.
      </>
    ),
  },
  {
    id: "item2",
    source: "TechCrunch · Wired · The Information",
    tag: "trending" as const,
    headline:
      "Perplexity raises $500M at $14B valuation — pivoting from search to autonomous browser agent",
    why: (
      <>
        You&apos;ve been tracking the <strong>search-to-agent shift</strong> for 3 weeks. This is the biggest signal yet that the pivot is real and funded.
      </>
    ),
  },
  {
    id: "item3",
    source: "YourStory",
    tag: "update" as const,
    sectionLabel: "India Startup",
    headline:
      "Zepto hits ₹5,000 Cr GMV — signals quick commerce profitability is achievable within 18 months",
    why: (
      <>
        Update to the quick commerce unit economics thread you&apos;ve been following since <strong>March</strong>. The profitability timeline moved up by 6 months.
      </>
    ),
  },
];

function formatLiveDate(date: Date) {
  const days = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  return `${days[date.getDay()]} ${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

export function DigestPreview() {
  const [liveDate, setLiveDate] = useState("");
  const [itemCount, setItemCount] = useState("0 / 10 items");
  const [status, setStatus] = useState<"generating" | "ready">("generating");
  const [visibleItems, setVisibleItems] = useState(0);
  const [showSkipped, setShowSkipped] = useState(false);
  const [showGreeting, setShowGreeting] = useState(false);
  const [showSub, setShowSub] = useState(false);
  const [showSection, setShowSection] = useState(false);

  useEffect(() => {
    setLiveDate(formatLiveDate(new Date()));
  }, []);

  useEffect(() => {
    const timers = [
      setTimeout(() => setShowGreeting(true), 800),
      setTimeout(() => setShowSub(true), 1200),
      setTimeout(() => setShowSection(true), 1600),
      setTimeout(() => { setVisibleItems(1); setItemCount("3 / 10 items"); }, 2000),
      setTimeout(() => { setVisibleItems(2); setItemCount("6 / 10 items"); }, 2700),
      setTimeout(() => { setVisibleItems(3); setItemCount("9 / 10 items"); }, 3400),
      setTimeout(() => { setShowSkipped(true); setItemCount("10 / 10 items"); }, 4200),
      setTimeout(() => setStatus("ready"), 4600),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <motion.div
      className="hero-right"
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 1, delay: 0.5, ease: "easeOut" }}
    >
      <div className="digest-window">
        <div className="window-bar">
          <div className="window-dots">
            <div className="window-dot" />
            <div className="window-dot" />
            <div className="window-dot" />
          </div>
          <span className="window-title">briefly.app — morning briefing</span>
          <div className="window-status">
            <div className={`status-dot ${status === "generating" ? "generating" : ""}`} />
            <span>{status}</span>
          </div>
        </div>

        <div className="digest-body">
          <div className="digest-header">
            <span className="digest-date">{liveDate}</span>
            <span className="digest-count">{itemCount}</span>
          </div>

          <motion.div
            className="digest-greeting"
            initial={{ opacity: 0 }}
            animate={{ opacity: showGreeting ? 1 : 0 }}
            transition={{ duration: 0.6 }}
          >
            Good morning, Arjun
            {status === "generating" && <span className="typing-cursor" />}
          </motion.div>

          <motion.div
            className="digest-sub"
            initial={{ opacity: 0 }}
            animate={{ opacity: showSub ? 1 : 0 }}
            transition={{ duration: 0.6 }}
          >
            Read 47 items across 12 sources. Here&apos;s what matters to you.
          </motion.div>

          <motion.div
            className="digest-section-label"
            initial={{ opacity: 0 }}
            animate={{ opacity: showSection ? 1 : 0 }}
            transition={{ duration: 0.5 }}
          >
            AI &amp; Product
          </motion.div>

          {digestItems.map((item, index) => (
            <div key={item.id}>
              {item.sectionLabel && index === 2 && (
                <motion.div
                  className="digest-section-label"
                  style={{ marginTop: 4 }}
                  initial={{ opacity: 0, y: 8 }}
                  animate={visibleItems >= 3 ? { opacity: 1, y: 0 } : {}}
                  transition={{ duration: 0.4 }}
                >
                  {item.sectionLabel}
                </motion.div>
              )}
              <motion.div
                className="digest-item"
                initial={{ opacity: 0, y: 8 }}
                animate={
                  visibleItems > index
                    ? { opacity: 1, y: 0 }
                    : { opacity: 0, y: 8 }
                }
                transition={{ duration: 0.4, ease: "easeOut" }}
                whileHover={{
                  paddingLeft: 8,
                  borderLeft: "2px solid rgba(201,168,92,0.15)",
                }}
              >
                <div className="item-meta">
                  <span className="item-source">{item.source}</span>
                  <span className={`item-tag tag-${item.tag}`}>
                    {item.tag === "trending" ? "×3 sources" : item.tag}
                  </span>
                </div>
                <div className="item-headline">{item.headline}</div>
                <div className="item-why">{item.why}</div>
              </motion.div>
            </div>
          ))}

          <motion.div
            className="skipped-note"
            initial={{ opacity: 0, y: 8 }}
            animate={showSkipped ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.6 }}
          >
            <span className="skipped-icon">
              <ArrowDownIcon size={12} />
            </span>
            <span className="skipped-text">
              Skipped <span>39 stories</span> — crypto price updates, remote work trend pieces, and 5 duplicate GPT-5 stories you saw yesterday.
            </span>
          </motion.div>

          <div className="digest-fade" />
        </div>
      </div>
    </motion.div>
  );
}
