"use client";

import { useState } from "react";
import { BrainDumpOverlay } from "./BrainDumpOverlay";

export function BrainDumpFab() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="brain-dump-fab"
        onClick={() => setOpen(true)}
        aria-label="Open brain dump"
        title="Dump your thoughts"
      >
        <span className="brain-dump-fab-icon" aria-hidden>✦</span>
        <span className="brain-dump-fab-label">Dump thoughts</span>
      </button>
      <BrainDumpOverlay open={open} onClose={() => setOpen(false)} />
    </>
  );
}
