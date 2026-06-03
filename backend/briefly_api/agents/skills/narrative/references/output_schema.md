# Output Schema

Return ONLY valid JSON. No markdown fences, no preamble, no explanation.

## Top-level fields

| Field          | Type   | Rules |
|----------------|--------|-------|
| subject_line   | string | Max 70 chars. Reference a specific story. Never "Your morning briefing". |
| preview_text   | string | Max 100 chars. Different hook from subject_line. 1 sentence. |
| skipped_note   | string | 1 sentence. What was filtered and why. Reference actual reasons. |
| items          | array  | One object per selected item. Same order as input. |

## Per-item fields

| Field                  | Type   | Rules |
|------------------------|--------|-------|
| content_id             | string | Copy exactly from input — do not change. |
| section                | string | Copy exactly from input's digest_section — do not change. |
| headline               | string | Max 12 words. Active voice. Specific. See voice_and_style.md. |
| summary                | string | 2 sentences max. Factual. No restating headline. |
| why_it_matters_to_you  | string | 1–2 sentences. Must be personal. See personalisation_patterns.md. |
| source_name            | string | Publication or source name. |
| source_url             | string | Direct URL. Required — never null or empty. |
| memory_reference       | string | 1 sentence or empty string. See memory_callout_rules.md. |
| confidence_signal      | string | 1 short phrase or empty string. |
| evolution_note         | string | 1 sentence or empty string. Only when divergence is genuine. |

## Example (single item)

```json
{
  "subject_line": "Anthropic raises $2.5B — and what that means for your Series A timing",
  "preview_text": "Plus: the EU's AI Act enforcement delay that changes your compliance roadmap.",
  "skipped_note": "Skipped 11 items — mostly earnings reports and crypto price updates you've deprioritised.",
  "items": [
    {
      "content_id": "abc-123",
      "section": "What's new",
      "headline": "Anthropic closes $2.5B round at $18.4B valuation targeting 100B parameter model",
      "summary": "Anthropic raised $2.5 billion at an $18.4 billion valuation, co-led by Google and Spark Capital. The round will fund development of a 100 billion parameter model the company expects to release in late 2026.",
      "why_it_matters_to_you": "You're raising a Series A in the AI infrastructure space — Anthropic's implied model pricing signals where enterprise contract floors are headed in the next 18 months.",
      "source_name": "The Information",
      "source_url": "https://www.theinformation.com/articles/anthropic-raises",
      "memory_reference": "5th update to the Anthropic funding thread you've been following since January.",
      "confidence_signal": "Matches your AI infrastructure cluster at 91%.",
      "evolution_note": ""
    }
  ]
}
```
