# Workforce Sub-Tools Guide

## Purpose

This folder is the sub-tool layer for workforce tools. Use it before adding new prompt logic or database-facing LLM behavior.

## Import path

Use `backend/src/lib/agent-tools/index.ts` as the import entrypoint.

## Prefer this folder when the query needs

- availability or near-bench retrieval
- 30/60/90 day capacity
- required and desired skill coverage
- candidate ranking
- role-aware team construction
- staffing risk detection
- EWA recommendation output
- compact summaries of tool results

## Module map

- `availability-search.ts` -> `availabilitySearch()`
- `capacity-calculator-30-60-90.ts` -> `capacityCalculator30_60_90()`
- `skills-matcher.ts` -> `skillsMatcher()`
- `candidate-scorer.ts` -> `candidateScorer()`
- `team-option-builder.ts` -> `teamOptionBuilder()`
- `risk-analyzer.ts` -> `riskAnalyzer()`
- `ewa-recommendation-builder.ts` -> `ewaRecommendationBuilder()`
- `explanation-generator.ts` -> `explanationGenerator()`

## Standard chain

1. Find the eligible supply set.
2. Measure skill fit.
3. Score and rank candidates.
4. Build role-level or team-level options.
5. Run risk checks.
6. Build EWA recommendations if assignments need approval.
7. Generate the final structured explanation.

## Detailed docs

See `docs/agent-tools/README.md` and the per-tool markdown files in `docs/agent-tools/`.
