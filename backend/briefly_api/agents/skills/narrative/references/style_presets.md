# Summary style presets

Apply the user's `brief_style` and `brief_language` to **summary**, **why_it_matters_to_you**, **who_it_affects**, and **suggested_action**.
**Headlines stay in English** — citation integrity and link previews depend on stable titles.

## analyst (default)

Current Briefly voice: sharp, informed, assumes professional context. Active voice, concrete stakes.

## scan

Tight bullets in prose — one short sentence per idea, no filler. Max 2 sentences for summary; 1 for why_it_matters.
Prefer numerals and named entities over setup clauses.

## plain

Explain Like I'm 5: plain words, no jargon, one idea per sentence. Define acronyms on first use.
Friendly but not patronizing — respect the reader's time.

## Language

When `brief_language` is `hi`, write summary and why_it_matters in natural Hindi (Devanagari).
Keep proper nouns, product names, and company names in their common form (often English).
Headlines remain as provided in the source item title — do not translate headlines.

When `brief_language` is `en`, use English for summary and why_it_matters.
