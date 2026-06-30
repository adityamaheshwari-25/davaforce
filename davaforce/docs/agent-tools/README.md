# Workforce Sub-Tools Guide

This directory is the detailed reference for the lower-level workforce sub-tools used by the main routed tools.

For discovery, start at the repo root `AGENTS.md`. For local code guidance, use `backend/src/lib/agent-tools/AGENTS.md`.

## Required rule

Use these sub-tools for retrieval, filtering, scoring, team construction, risk checks, EWA recommendation building, and explanation shaping.

Do not ask an LLM to inspect the normalized SQLite database directly when one of these tools can answer the question.

## Fast module selection

- Availability, bench, near-bench, location, BU, function, grade filters -> `availabilitySearch()`
- 30/60/90 day aggregate capacity, bench movement, scenario targets -> `capacityCalculator30_60_90()`
- Required and desired skill coverage -> `skillsMatcher()`
- Candidate ranking for a role -> `candidateScorer()`
- Team construction across one or more roles -> `teamOptionBuilder()`
- Gap, overlap, EWA, and partial-capacity risk -> `riskAnalyzer()`
- Approval and EWA action recommendations -> `ewaRecommendationBuilder()`
- Tool-ready explanation or summary of tool output -> `explanationGenerator()`

## Standard flows

1. Availability lookup
   `availabilitySearch()` -> `explanationGenerator()`

2. Ranked shortlist
   `availabilitySearch()` -> `skillsMatcher()` -> `candidateScorer()` -> `explanationGenerator()`

3. Team recommendation
   `availabilitySearch()` -> `skillsMatcher()` -> `candidateScorer()` -> `teamOptionBuilder()` -> `riskAnalyzer()` -> `ewaRecommendationBuilder()` -> `explanationGenerator()`

4. Capacity outlook and scenario targets
   `capacityCalculator30_60_90()` -> `explanationGenerator()`

## Module docs

- [availabilitySearch](./availabilitySearch.md)
- [capacityCalculator30_60_90](./capacityCalculator30_60_90.md)
- [skillsMatcher](./skillsMatcher.md)
- [candidateScorer](./candidateScorer.md)
- [teamOptionBuilder](./teamOptionBuilder.md)
- [riskAnalyzer](./riskAnalyzer.md)
- [ewaRecommendationBuilder](./ewaRecommendationBuilder.md)
- [explanationGenerator](./explanationGenerator.md)
- [explanationPatterns](./explanationPatterns.md)

## Source locations

- `backend/src/lib/agent-tools/index.ts`
- `backend/src/lib/agent-tools/README.md`
- `backend/src/lib/agent-tools/AGENTS.md`
