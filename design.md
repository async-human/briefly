# Design — Briefly

Locked design system for the Briefly app shell. Dashboard and in-app surfaces read this before visual changes.

## Genre

modern-minimal with editorial warmth — knowledge-work utility, not marketing flash.

## App macrostructure

**Workbench** — sidebar navigation + primary canvas + secondary sources rail. Function carries the page; no hero enrichment.

## Theme (Lumen-adjacent)

- `--color-paper` canvas: warm near-white
- `--color-paper-2` sidebar: cool grey-violet wash
- `--color-ink` primary text: deep blue-grey
- `--color-accent` action: refined indigo (~278°)
- `--color-brand` mark: warm gold (~65°)

Mapped in `frontend/styles/app-dashboard.css` as `--app-*` tokens.

## Typography

- Display / page titles: `var(--font-serif)` (Playfair Display), weight 600, roman only
- Body / UI: `var(--font-sans)` (DM Sans)
- Mono / metrics: `var(--font-mono)` (DM Mono)

## Motion

- Easing: `cubic-bezier(0.22, 1, 0.36, 1)` as `--app-ease`
- Durations: 160ms UI, 480ms reveals, 2.4–3.2s ambient loaders
- Animate `transform` and `opacity` only
- `prefers-reduced-motion`: collapse to opacity ≤150ms

## Loaders

- **Brief loader**: stacked page sheets with staggered line reveal + soft orbital glow
- **Generating panel**: ring progress + phased step list (active / done / pending)
- **Page skeleton**: fade-rise surfaces, no bounce

## CTA voice

- Primary: filled indigo, 6px radius, medium weight label
- Secondary: hairline border, canvas fill, hover muted wash

## What app pages share

- Sidebar + canvas grid
- Accent ≤5% per viewport
- Surface shadow: single hairline + 1px lift
- Status dot: breathing pulse on indigo
