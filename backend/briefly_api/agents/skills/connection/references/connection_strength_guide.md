# Connection Strength Calibration Guide

connection_strength is a 0.0–1.0 float. Use these examples to calibrate.

## 0.9–1.0 — Same event, direct continuation
- Thread "anthropic-series-e" + item that is the official press release → 1.0
- Thread "openai-board-drama" + item reporting same day update → 0.95

## 0.7–0.89 — Same named event, additional angle
- Thread "eu-ai-act" + item about enforcement body creation → 0.80
- Thread "mistral-funding" + item about Mistral's new model (same company) → 0.72

## 0.5–0.69 — Related theme, overlapping actors
- Thread "ai-regulation" (US focus) + item about UK AI regulation → 0.55
- Thread "openai-safety" + item about Anthropic's safety approach → 0.60

## 0.3–0.49 — Loose thematic connection
- Thread "llm-benchmarks" + item about AI evaluation methodology → 0.40
- Thread "startup-funding" + item about general VC market trends → 0.35

## 0.0–0.29 — Not meaningfully connected
- Thread "ai-reliability" + item about cybersecurity → 0.10
- Any connection based only on both items being "tech news" → 0.05

## Rule of thumb
If you would not feel confident saying "this is an update to the [thread] story
you've been following" in the briefing, the connection_strength is below 0.6
and connected should be false.
