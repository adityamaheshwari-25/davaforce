# Agent Guide

## Scope

This is the primary entrypoint for Codex and other agents working on workforce planning, staffing, or dashboard logic in this repository.

## Core rule

Prefer deterministic workforce sub-tools in `backend/src/lib/agent-tools/` over freeform LLM reasoning whenever the answer depends on:

- availability or bench status
- 30/60/90 day capacity
- skill matching
- candidate ranking
- team construction
- staffing risk checks
- EWA recommendations
- structured user-facing explanations

Do not ask an LLM to inspect the normalized SQLite dataset directly when a tool can answer the question.

## Start here

1. Read `docs/agent-tools/README.md` for the routing map and execution patterns.
2. Import sub-tools from `backend/src/lib/agent-tools/index.ts`.
3. Open the specific tool doc in `docs/agent-tools/` before building a new tool, workflow step, or router behavior.

## Quick routing

- "Who is available?" -> `availabilitySearch()`
- "Show 30/60/90 day capacity" -> `capacityCalculator30_60_90()`
- "Who matches these skills?" -> `availabilitySearch()` then `skillsMatcher()`
- "Rank candidates for this role" -> `candidateScorer()`
- "Build team options for this opportunity" -> `teamOptionBuilder()`
- "What are the staffing or delivery risks?" -> `riskAnalyzer()`
- "What approvals or EWA actions are needed?" -> `ewaRecommendationBuilder()`
- "Turn tool output into a compact answer" -> `explanationGenerator()`

## Standard execution chains

- Availability answer: `availabilitySearch()` -> `explanationGenerator()`
- Ranked shortlist: `availabilitySearch()` -> `skillsMatcher()` -> `candidateScorer()` -> `explanationGenerator()`
- Team recommendation: `availabilitySearch()` -> `skillsMatcher()` -> `candidateScorer()` -> `teamOptionBuilder()` -> `riskAnalyzer()` -> `ewaRecommendationBuilder()` -> `explanationGenerator()`
- Capacity outlook: `capacityCalculator30_60_90()` -> `explanationGenerator()`

## Key locations

- Detailed sub-tool docs: `docs/agent-tools/README.md`
- Sub-tool code: `backend/src/lib/agent-tools/`
- Local code guide: `backend/src/lib/agent-tools/AGENTS.md`
