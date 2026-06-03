# Contradiction Detection Rules

## When the similarity score is 0.70–0.79 (borderline)
Be conservative. Only flag as contradicting if the factual conflict is explicit
and unambiguous — do not infer contradiction from context.

## When the similarity score is ≥ 0.80 (high overlap)
Standard rules apply — flag if a specific factual claim is negated or
significantly revised.

## Numbers that constitute a material contradiction
| Metric type         | Threshold for "material" |
|---------------------|--------------------------|
| Funding amounts     | >10% difference          |
| Headcount           | >15% difference          |
| Dates/deadlines     | Any difference (dates are exact) |
| Rankings            | >2 positions             |
| Revenue/profit      | >10% difference          |
| User/customer counts| >20% difference          |

## Worked examples

### Example 1 — Contradiction
Old: "Stability AI lays off 10% of staff, retaining 150 employees"
New: "Stability AI down to 40 employees after second round of cuts"
→ contradicts: true. Explanation: "Old item stated Stability AI had ~150 employees; new item reports only 40 remain."

### Example 2 — NOT a contradiction (continuation)
Old: "UK government plans AI safety summit for November"
New: "UK AI safety summit scheduled for November 1-2 at Bletchley Park"
→ contradicts: false. The new item adds specificity, doesn't negate the old claim.

### Example 3 — NOT a contradiction (opinion)
Old: "Analysts say GPT-4 is the best available model"
New: "Researchers argue Claude 3 outperforms GPT-4 on reasoning tasks"
→ contradicts: false. These are competing claims/opinions, not one fact negating another.

### Example 4 — Contradiction (reversed outcome)
Old: "Adobe's acquisition of Figma approved by EU regulators"
New: "Adobe abandons Figma acquisition after EU regulators block deal"
→ contradicts: true. Explanation: "Old item stated the acquisition was approved; new item reports it was blocked and abandoned."
