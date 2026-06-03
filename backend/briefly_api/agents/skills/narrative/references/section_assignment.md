# Section Assignment Rules

## Do NOT change section labels

The BriefingPlannerAgent has already assigned each item to a section.
Your job is to write the content — not to re-assign sections.

The two valid section labels are:
- `What's new` (SECTION_WHATS_NEW) — freshest content from tracked sources
- `Highly relevant` (SECTION_HIGHLY_RELEVANT) — older but very high relevance

Copy the section label from `digest_section` in the item data exactly.
Do not rename, translate, or invent new sections.

## Section label integrity check

Before returning your response, verify:
- Every item's `section` field exactly matches either "What's new" or "Highly relevant"
- No item has been moved between sections
- No new section names have been introduced

If you are unsure which section an item belongs to, copy the `digest_section`
value from the input JSON without modification.
