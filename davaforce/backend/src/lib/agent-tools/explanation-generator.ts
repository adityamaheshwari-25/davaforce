import type { AvailabilitySearchOutput } from "./availability-search";
import type { CandidateScore } from "./candidate-scorer";
import type { EwaRecommendationBuilderOutput } from "./ewa-recommendation-builder";
import type { RiskAnalyzerOutput } from "./risk-analyzer";
import type { TeamOption } from "./team-option-builder";

export type ExplanationGeneratorInput = {
  intent: "availability-search" | "candidate-ranking" | "team-options" | "risk-review" | "ewa-review";
  title?: string;
  audience?: string;
  filters?: Record<string, string | number | null | string[]>;
  availability?: AvailabilitySearchOutput["summary"];
  scoredCandidates?: CandidateScore[];
  teamOption?: TeamOption;
  riskAnalysis?: RiskAnalyzerOutput;
  ewaRecommendation?: EwaRecommendationBuilderOutput;
  maxCandidates?: number;
};

export type ExplanationGeneratorOutput = {
  title: string;
  summary: string;
  highlights: string[];
  risks: string[];
  nextActions: string[];
  evidenceLines: string[];
  markdown: string;
};

const formatFilters = (filters?: ExplanationGeneratorInput["filters"]) => {
  if (!filters) {
    return "";
  }

  return Object.entries(filters)
    .filter(([, value]) => value != null && (!(Array.isArray(value)) || value.length > 0))
    .map(([key, value]) => `${key}=${Array.isArray(value) ? value.join(", ") : String(value)}`)
    .join("; ");
};

export function explanationGenerator(input: ExplanationGeneratorInput): ExplanationGeneratorOutput {
  const maxCandidates = input.maxCandidates ?? 3;
  const title =
    input.title ??
    (input.intent === "availability-search"
      ? "Availability Search Summary"
      : input.intent === "candidate-ranking"
        ? "Candidate Ranking Summary"
        : input.intent === "team-options"
          ? "Team Option Summary"
          : input.intent === "risk-review"
            ? "Risk Review Summary"
            : "EWA Review Summary");
  const filterText = formatFilters(input.filters);
  const highlights: string[] = [];
  const risks: string[] = [];
  const nextActions: string[] = [];
  const evidenceLines: string[] = [];

  if (input.availability) {
    highlights.push(
      `${input.availability.totalCandidates} candidate(s) matched the availability search with ${input.availability.availableInWindowFte} FTE in window.`,
    );
    evidenceLines.push(
      `${input.availability.currentBenchPeople} current-bench person(s) and ${input.availability.partialCapacityPeople} partial-capacity person(s) are in the result set.`,
    );
  }

  if (input.scoredCandidates && input.scoredCandidates.length > 0) {
    const topCandidates = input.scoredCandidates.slice(0, maxCandidates);
    highlights.push(
      `Top candidates: ${topCandidates.map((candidate) => `${candidate.name} (${candidate.fitBucket}, ${candidate.totalScore})`).join("; ")}.`,
    );
    if (topCandidates.some((candidate) => candidate.missingRequiredSkills.length > 0)) {
      risks.push("Some top-ranked candidates still miss required skills and need review.");
    }
  }

  if (input.teamOption) {
    highlights.push(
      `${input.teamOption.summary.assignedRoles} role(s) are fully assigned with ${input.teamOption.summary.assignedFte} FTE allocated.`,
    );
    if (input.teamOption.summary.unfilledRoles > 0) {
      risks.push(`${input.teamOption.summary.unfilledRoles} role(s) remain unfilled.`);
    }
    if (input.teamOption.summary.stretchAssignments > 0) {
      risks.push(`${input.teamOption.summary.stretchAssignments} assignment(s) rely on stretch-fit candidates.`);
    }
  }

  if (input.riskAnalysis) {
    highlights.push(
      `Overall risk score ${input.riskAnalysis.summary.overallRiskScore} with highest severity ${input.riskAnalysis.summary.highestSeverity}.`,
    );
    risks.push(...input.riskAnalysis.risks.slice(0, 4).map((risk) => `${risk.title}: ${risk.detail}`));
    nextActions.push(...input.riskAnalysis.nextActions);
  }

  if (input.ewaRecommendation) {
    highlights.push(
      `EWA actions: create=${input.ewaRecommendation.summary.createEwaRequest}, pending follow-up=${input.ewaRecommendation.summary.followUpPendingApproval}, blocked remediation=${input.ewaRecommendation.summary.replaceOrResequence}.`,
    );
    nextActions.push(...input.ewaRecommendation.nextActions);
  }

  if (filterText) {
    evidenceLines.push(`Applied filters: ${filterText}.`);
  }
  if (input.audience) {
    evidenceLines.push(`Audience: ${input.audience}.`);
  }

  const summary =
    highlights[0] ??
    (input.intent === "risk-review"
      ? "Risk review completed from tool evidence."
      : "Explanation generated from tool outputs.");
  const markdownSections = [
    `# ${title}`,
    "",
    summary,
    highlights.length > 1 ? `\n## Highlights\n- ${highlights.join("\n- ")}` : "",
    risks.length > 0 ? `\n## Risks\n- ${risks.join("\n- ")}` : "",
    nextActions.length > 0 ? `\n## Next Actions\n- ${nextActions.join("\n- ")}` : "",
    evidenceLines.length > 0 ? `\n## Evidence\n- ${evidenceLines.join("\n- ")}` : "",
  ].filter(Boolean);

  return {
    title,
    summary,
    highlights,
    risks,
    nextActions,
    evidenceLines,
    markdown: markdownSections.join("\n"),
  };
}
