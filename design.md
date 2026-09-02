# Design — Briefly

Locked design system for Briefly. Marketing, dashboard and in-app surfaces read this before visual changes.

## Genre

Art Deco editorial — ivory paper, deep teal ink, restrained gold geometry. A composed private intelligence salon, not a SaaS control panel.

## Hallmark passes

- **v1** — Workbench tokens, OKLCH palette, stacked-page loaders
- **v2** — Airier rhythm, border-only surfaces, sidebar accent rail, redundant chrome removed
- **v3** — Marketing redesign: Feature Stack loop, scroll-synced stage meters, N10 nav morph, all section eyebrows removed
- **v4** — Marketing rebuilt as Split Studio: floating pill nav, alternating proof pairs, letter-close footer, generous display leading
- **v5** — Art Deco Grand Salon: symmetric masthead, framed hero brief, jewel-toned memory chamber, asymmetric action composition, expanded footer
- **v6** — Dashboard priority pass: open greeting, urgent-signal restraint, briefing-first canvas, quiet utilities, optional intelligence depth
- **v7** — Workbench uses the canvas: wide briefing + sticky rail, story cards, collapsible device groups
- **v9** — Glance hierarchy pass: pill counts, framed Your World constellation, denser Intelligence Cards, briefing recedes behind “the rest of today.”
- **v10** — Decision loop refinement: evidence cards disclose why they rose; the read view captures a quiet, receipt-backed decision outcome; outcomes enter the existing timeline without a new surface.
- **v11** — Decision-first dashboard: three ranked conclusions lead the first viewport; the world ledger becomes supporting disclosure; briefing content resolves into For you today, From your world, and Explore; the intelligence rail is capped at four observations.

## App macrostructure

**Workbench** — sidebar navigation + primary canvas + secondary sources rail. Function carries the page; no hero enrichment.

The canvas opens on a **decision layer**: greeting, honest pill counts, and at most three ranked Intelligence Cards. These are conclusions rather than article previews: what changed, why it matters, what evidence supports it, and whether a decision may need review. The world graph follows as a compact supporting disclosure, never as the first substantive object.

The remaining depth is progressive: **Your briefing** opens into exactly three information levels — **For you today**, **From your world**, and **Explore**. Discovery is capped at three compact items. The sticky **Briefly Intelligence** rail carries no more than four observations: a shift, a blind spot, a progressing thread, a connection, or a coverage recommendation. No repeated article-section synonyms.

On wide viewports the lower canvas is a two-column workbench: today’s briefing fills the main column; the concise Intelligence panel leads a narrower sticky rail, followed by meetings. Change and event cards are the interaction surface. Setup prompts never displace the daily brief.

## Marketing macrostructure

**Grand Salon (custom)** — a symmetrical arrival opens into asymmetric editorial compositions. Geometric rules and framed content provide the Art Deco register; product information remains direct and contemporary.

- Hero: centered ornament line, left-biased statement, and a Tier-A framed brief; no fake browser chrome
- Navigation: symmetric masthead — page links left, wordmark center, access right
- Footer: expanded masthead directory — large wordmark, three spacious link groups, split metadata row
- Section rhythm: grand arrival → compact source register → editorial method → jewel memory chamber → asymmetric actions → gated direction → centered invitation
- **No section eyebrows.** No `01 / LABEL` kickers, and never a label beside a heading
- Gold is reserved for CTAs, rules, diamonds, and numerals; deep teal carries large surfaces
- Display line-height never drops below 1.02. Footer groups stack before their links become cramped

## Marketing motion

Three primitives, and no more:

1. **Hero entrance** — one orchestrated stagger on load, 70ms per DOM index, capped under 500ms total
2. **Section reveal** — composed content groups fade up once when they first enter view
3. **CTA hover** — primary fill inverts to ink; secondary slides its arrow only

No section-wide fade-ins, no infinite loops, no parallax. No layout property is ever transitioned.

## Theme (custom Art Deco)

- `--color-paper` canvas: warm ivory (~82°)
- `--color-paper-2` surface: champagne wash (~82°)
- `--color-ink` primary text: deep teal (~205°)
- `--color-accent` action and ornament: restrained gold (~78°)
- `--color-jewel` feature chamber and footer: deep teal (~195°)

Mapped in `frontend/styles/app-dashboard.css` as `--app-*` tokens.

## Typography

- Display / page titles: `var(--font-art-deco)` (Cormorant Garamond), weights 600–700, roman only
- Body / UI: `var(--font-sans)` (DM Sans)
- Mono / metrics: `var(--font-mono)` (DM Mono)

Mono is the outlier register and carries exactly one role: **figures**. Counters, panel indices, layer numbers, tabular data. Never labels, never body copy, never kickers.

## App motion

- Easing: `cubic-bezier(0.22, 1, 0.36, 1)` as `--app-ease`
- Durations: 160ms UI, 480ms reveals, 2.4–3.2s ambient loaders
- Animate `transform` and `opacity` only
- `prefers-reduced-motion`: collapse to opacity ≤150ms

## Loaders

- **Brief loader**: stacked page sheets with staggered line reveal + soft orbital glow
- **Generating panel**: ring progress + phased step list (active / done / pending)
- **Page skeleton**: fade-rise surfaces, no bounce

## CTA voice

- Primary: filled indigo, 6px radius, medium weight label. Hover inverts the fill to ink — one signal, never a fill change plus a lift plus an icon slide.
- Secondary (app): hairline border, canvas fill, hover muted wash
- Secondary (marketing): typographic link — label, hairline underline, arrow. Hover slides the arrow only.
- Every affordance is `white-space: nowrap` and at least 2.75rem tall

## What app pages share

- Sidebar + canvas grid
- Accent ≤5% per viewport
- Surface shadow: single hairline + 1px lift
- Status dot: breathing pulse on indigo

## Exports

The landing source of truth is `frontend/tokens.css`. These mappings make the system portable without changing the live app.

### tokens.css

```css
.market-landing {
  --color-paper: oklch(98.4% 0.008 85);
  --color-paper-2: oklch(95.8% 0.014 83);
  --color-paper-3: oklch(92.8% 0.022 80);
  --color-ink: oklch(21% 0.028 270);
  --color-ink-2: oklch(39% 0.026 270);
  --color-muted: oklch(44% 0.022 270);
  --color-rule: oklch(85% 0.018 80);
  --color-accent: oklch(43% 0.17 278);
  --color-accent-ink: oklch(98% 0.008 85);
  --color-focus: oklch(55% 0.19 278);
  --font-display: var(--font-serif), Georgia, serif;
  --font-body: var(--font-sans), system-ui, sans-serif;
  --font-mono: var(--font-mono), ui-monospace, monospace;
  --space-sm: 1rem;
  --space-md: 1.5rem;
  --space-lg: 2rem;
  --space-xl: 3rem;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --radius-card: 0.75rem;
  --radius-control: 0.375rem;
}
```

### Tailwind v4 `@theme`

```css
@theme {
  --color-paper: oklch(98.4% 0.008 85);
  --color-paper-2: oklch(95.8% 0.014 83);
  --color-ink: oklch(21% 0.028 270);
  --color-ink-2: oklch(39% 0.026 270);
  --color-accent: oklch(43% 0.17 278);
  --color-focus: oklch(55% 0.19 278);
  --font-display: var(--font-serif), Georgia, serif;
  --font-body: var(--font-sans), system-ui, sans-serif;
  --spacing-sm: 1rem;
  --spacing-md: 1.5rem;
  --spacing-lg: 2rem;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
}
```

### DTCG `tokens.json`

```json
{
  "$schema": "https://design-tokens.github.io/community-group/format/",
  "color": {
    "paper": { "$value": "oklch(98.4% 0.008 85)", "$type": "color" },
    "ink": { "$value": "oklch(21% 0.028 270)", "$type": "color" },
    "accent": { "$value": "oklch(43% 0.17 278)", "$type": "color" }
  },
  "font": {
    "display": { "$value": "Playfair Display, Georgia, serif", "$type": "fontFamily" },
    "body": { "$value": "DM Sans, system-ui, sans-serif", "$type": "fontFamily" }
  },
  "space": {
    "sm": { "$value": "1rem", "$type": "dimension" },
    "md": { "$value": "1.5rem", "$type": "dimension" },
    "lg": { "$value": "2rem", "$type": "dimension" }
  }
}
```

### shadcn/ui CSS variables

```css
:root {
  --background: 98.4% 0.008 85;
  --foreground: 21% 0.028 270;
  --card: 95.8% 0.014 83;
  --card-foreground: 21% 0.028 270;
  --primary: 43% 0.17 278;
  --primary-foreground: 98% 0.008 85;
  --muted: 85% 0.018 80;
  --muted-foreground: 44% 0.022 270;
  --border: 85% 0.018 80;
  --input: 85% 0.018 80;
  --ring: 55% 0.19 278;
  --radius: 0.75rem;
}
```
