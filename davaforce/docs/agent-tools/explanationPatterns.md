# Explanation Patterns

Use `explanationGenerator()` after workforce tools or sub-tools, not before.

## Preferred patterns

- Availability answer: `availabilitySearch()` -> `explanationGenerator()`
- Ranked shortlist: `candidateScorer()` -> `explanationGenerator()`
- Team recommendation: `teamOptionBuilder()` -> `riskAnalyzer()` -> `ewaRecommendationBuilder()` -> `explanationGenerator()`

## Rule

The explanation layer should summarize tool output. It should not invent missing people, scores, dates, or approval status.
