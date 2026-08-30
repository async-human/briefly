# Design — Briefly

Locked design system for Briefly. Marketing, dashboard and in-app surfaces read this before visual changes.

## Genre

editorial-minimal — warm paper, serif display, restrained indigo accent. A morning journal, not a SaaS control panel.

## Hallmark passes

- **v1** — Workbench tokens, OKLCH palette, stacked-page loaders
- **v2** — Airier rhythm, border-only surfaces, sidebar accent rail, redundant chrome removed

## App macrostructure

**Workbench** — sidebar navigation + primary canvas + secondary sources rail. Function carries the page; no hero enrichment.

## Marketing macrostructure

**Narrative Workflow** — an asymmetric split hero followed by the product loop in sequence: decide → remember → act. Product direction is presented as gated layers, never as a list of unshipped claims.

- Hero: split diptych with a Tier-A intelligence dossier; no fake browser chrome
- Navigation: N9 edge-aligned minimal
- Footer: Ft5 statement close
- Section rhythm: stacked stage label → heading → body, with hairline divisions

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
