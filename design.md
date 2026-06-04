# Design — Briefly App

Locked design system for authenticated app surfaces (dashboard, history, settings).
Landing/marketing uses editorial Hallmark separately; app pages read this file.

## Genre

modern-minimal — product workbench, calm infrastructure, hairline structure.

## Macrostructure family

- **App pages:** Workbench — functional header, primary content column, optional secondary rail (sources / meta).
- **Marketing pages:** Long Document (hallmark-landing) — do not mix tokens without intent.

## Theme (app)

Cool light paper, cool ink, single signal accent (briefly gold-cobalt hybrid).

- Display: Playfair Display (existing `--font-serif`)
- Body: DM Sans (`--font-sans`)
- Labels: DM Mono (`--font-mono`)

Tokens live in `frontend/styles/hallmark-dashboard.css` and map to app `--bg`, `--text`, `--accent` variables.

## Spacing

4pt scale via `--hm-space-*`; components use existing `--space` aliases where wired.

## Motion

- Reveal: opacity only, ≤220ms, `--hm-ease-out`
- `prefers-reduced-motion`: no transforms on hover lifts

## CTA voice

- Primary: filled ink pill, single line, 6px radius
- Secondary: hairline outline on `--border`

## Per-page rules

- App pages: no hero enrichment, no marketing gradients
- Sources rail collapses to sheet/toggle below 60rem

## What pages MUST share

Wordmark, accent placement, card hairlines, nav destinations (Today · History · Preferences).
