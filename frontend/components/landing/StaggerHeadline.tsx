"use client";

import { motion, useReducedMotion } from "framer-motion";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

type StaggerHeadlineProps = {
  text: string;
  className?: string;
  as?: "h1" | "h2";
  baseDelay?: number;
  /** "mount" animates immediately (hero); "inView" waits until scrolled into view */
  trigger?: "mount" | "inView";
  /** Substring of `text` rendered with the accent shimmer treatment */
  highlight?: string;
};

type Token = { kind: "word"; text: string; highlighted: boolean } | { kind: "break" };

function tokenize(text: string, highlight?: string): Token[] {
  const hlStart = highlight ? text.indexOf(highlight) : -1;
  const hlEnd = hlStart >= 0 && highlight ? hlStart + highlight.length : -1;
  const tokens: Token[] = [];
  let offset = 0;

  text.split("\n").forEach((line, lineIdx) => {
    if (lineIdx > 0) {
      tokens.push({ kind: "break" });
      offset += 1; // the \n itself
    }
    const re = /\S+/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(line))) {
      const start = offset + match.index;
      tokens.push({
        kind: "word",
        text: match[0],
        highlighted: hlStart >= 0 && start >= hlStart && start < hlEnd,
      });
    }
    offset += line.length;
  });

  return tokens;
}

export function StaggerHeadline({
  text,
  className,
  as: Tag = "h1",
  baseDelay = 0.1,
  trigger = "mount",
  highlight,
}: StaggerHeadlineProps) {
  const reducedMotion = useReducedMotion();
  const tokens = tokenize(text, highlight);

  if (reducedMotion) {
    return (
      <Tag className={className} aria-label={text}>
        {tokens.map((t, i) =>
          t.kind === "break" ? (
            <br key={`br-${i}`} />
          ) : (
            <span
              key={`${t.text}-${i}`}
              className={`stagger-headline-word${t.highlighted ? " headline-shimmer" : ""}`}
            >
              {t.text}
            </span>
          )
        )}
      </Tag>
    );
  }

  let wordIdx = -1;

  return (
    <Tag className={className} aria-label={text}>
      {tokens.map((t, i) => {
        if (t.kind === "break") return <br key={`br-${i}`} />;
        wordIdx++;
        const transition = {
          duration: 0.48,
          delay: baseDelay + wordIdx * 0.055,
          ease: EASE,
        };
        return (
          <motion.span
            key={`${t.text}-${i}`}
            className={`stagger-headline-word${t.highlighted ? " headline-shimmer" : ""}`}
            initial={{ opacity: 0, y: 14 }}
            {...(trigger === "inView"
              ? {
                  whileInView: { opacity: 1, y: 0 },
                  viewport: { once: true, margin: "-60px" },
                }
              : { animate: { opacity: 1, y: 0 } })}
            transition={transition}
          >
            {t.text}
          </motion.span>
        );
      })}
    </Tag>
  );
}
