"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";

const items = [
  {
    source: "The Rundown AI · TechCrunch",
    headline: "Anthropic's Claude 4 shows 40% improvement on agentic tasks",
    why: (
      <>
        As someone building an <strong>agent-based product</strong>, this directly affects how much you can trust multi-step tool calls without human review.
      </>
    ),
  },
  {
    source: "Stratechery",
    headline: "The platform shift from search to autonomous agents is accelerating",
    why: (
      <>
        You&apos;ve been tracking the <strong>search-to-agent shift</strong> for 3 weeks. This is the biggest signal yet.
      </>
    ),
  },
];

function formatDate(date: Date) {
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export function ProductPreview() {
  const [date, setDate] = useState("");
  const [visible, setVisible] = useState(0);

  useEffect(() => {
    setDate(formatDate(new Date()));
  }, []);

  useEffect(() => {
    const timers = [
      setTimeout(() => setVisible(1), 600),
      setTimeout(() => setVisible(2), 1200),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <motion.div
      className="hero-preview-wrap"
      initial={{ opacity: 0, y: 32 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.9, delay: 0.3, ease: "easeOut" }}
    >
      <div className="product-frame">
        <div className="product-chrome">
          <span className="product-chrome-title">briefly</span>
          <span className="product-chrome-status">
            <span className="status-pulse live" />
            ready
          </span>
        </div>
        <div className="product-body" style={{ minHeight: 320 }}>
          <div className="digest-meta">
            <span className="digest-date">{date}</span>
            <span className="digest-count">8 / 10 items</span>
          </div>
          <motion.p
            className="digest-greeting"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.5 }}
          >
            Good morning
          </motion.p>
          <motion.p
            className="digest-summary"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.7 }}
          >
            8 items from 47 sources. Here&apos;s what matters.
          </motion.p>

          <div className="digest-section">AI & Product</div>

          {items.map((item, i) => (
            <motion.div
              key={item.headline}
              className="digest-item"
              initial={{ opacity: 0, y: 12 }}
              animate={visible > i ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.5, delay: 0.9 + i * 0.2 }}
            >
              <div className="item-source">{item.source}</div>
              <div className="item-headline">{item.headline}</div>
              <div className="item-why">{item.why}</div>
            </motion.div>
          ))}

          <motion.p
            className="skipped-line"
            initial={{ opacity: 0 }}
            animate={{ opacity: visible >= 2 ? 1 : 0 }}
            transition={{ duration: 0.4, delay: 1.4 }}
          >
            <span>39 stories skipped</span> — off-topic, duplicates, already seen
          </motion.p>
        </div>
      </div>
    </motion.div>
  );
}
