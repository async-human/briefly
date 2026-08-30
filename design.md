# Design — Briefly

Locked design system for Briefly. Marketing, dashboard and in-app surfaces read this before visual changes.

## Genre

editorial-minimal — warm paper, serif display, restrained indigo accent. A morning journal, not a SaaS control panel.

## Hallmark passes

- **v1** — Workbench tokens, OKLCH palette, stacked-page loaders
- **v2** — Airier rhythm, border-only surfaces, sidebar accent rail, redundant chrome removed
- **v3** — Marketing redesign: Feature Stack loop, scroll-synced stage meters, N10 nav morph, all section eyebrows removed

## App macrostructure

**Workbench** — sidebar navigation + primary canvas + secondary sources rail. Function carries the page; no hero enrichment.

## Marketing macrostructure

**Feature Stack** — an asymmetric split hero, then the product loop as three scroll-synced stages: decide → remember → act. Each stage pins a one-word verb on the left while its panels scroll past on the right. Product direction is presented as gated layers, never as a list of unshipped claims.

- Hero: asymmetric split with a Tier-A brief card, offset below the copy baseline; no fake browser chrome
- Navigation: N10 floating-on-scroll morph — full-bleed bar cross-fades into a detached plate past 80px
- Footer: Ft1 mast-headed — wordmark, tagline, inline links
- Section rhythm: heading → body, single column, deliberately uneven padding between sections
- **No section eyebrows.** No `01 / LABEL` kickers, and never a label beside a heading. Stage identity is carried by the heading itself.
- Accent is reserved for CTAs, the active scroll position, and numerals

## Marketing motion

Three primitives, and no more:

1. **Nav morph** — one cross-fade past an 80px threshold. Constant height, transform-only offset, one curve. Desktop only.
2. **Hero entrance** — one orchestrated stagger on load, 70ms per DOM index, capped under 500ms total.
3. **Scroll-synced stage meter** — `IntersectionObserver` on a narrow viewport band reports the active panel to the pinned pane.

No section fade-ins, no infinite loops, no parallax. Nothing below the nav shifts when the nav morphs; no layout property is ever transitioned.

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
