import { existsSync } from "node:fs";
import { getDummyUserById } from "../lib/dummy-users-store";
import { readDatasetRecord, type WorkforceDatasetRecord } from "../lib/workforce-dataset-store";
import { buildWorkforceDashboardSkillGaps } from "../lib/workforce-dashboard";
import {
  appendWorkforceConversationMessage,
  getOrCreateWorkforceConversation,
  readWorkforceConversation,
  updateWorkforceConversationMemory,
  type WorkforceConversationMessage,
  type WorkforceConversationSummary,
} from "../lib/workforce-conversation-store";
import { assessOpportunity } from "../mastra/tools/opportunity-assessment-tool";
import { findResourceSupply } from "../mastra/tools/resource-supply-tool";
import { buildTeamOptions } from "../mastra/tools/team-builder-tool";
import { routeWorkforceQuestion } from "../mastra/tools/workforce-router-tool";
import { queryGenericDataset, type GenericDatasetQueryOutput } from "../mastra/tools/generic-dataset-query-tool";
import type { WorkforceRouterOutput } from "../mastra/schemas/workforce-planning-schemas";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type WorkspaceDetailView = "overview" | "staffing-fit" | "supply-risk" | "skill-gaps" | "demand" | "table-query";

type WorkspaceChatRequest = {
  userId?: string;
  datasetId?: string;
  conversationId?: string;
  message?: string;
};

type DetailCard = {
  label: string;
  value: string;
  detail?: string;
};

type DetailChart = {
  type: "bar";
  title: string;
  data: Array<{ label: string; value: number; color?: string }>;
};

type DetailTable = {
  title: string;
  headers: string[];
  rows: string[][];
};

type WorkspaceChatDetails = {
  view: WorkspaceDetailView;
  title: string;
  summary: string;
  cards: DetailCard[];
  charts: DetailChart[];
  tables: DetailTable[];
  json: Record<string, unknown>;
};

type EwaBlockerRow = {
  ewaRequestId: string;
  opportunityName: string;
  roleName: string;
  personName: string;
  ewaStatus: string;
  requestedFte: number;
  blockingReason: string;
  nextAction: string;
};

type ChatContextMessage = Pick<WorkforceConversationMessage, "role" | "content">;

const json = (body: unknown, status = 200) => Response.json(body, { status });

class HttpError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

const text = (value: unknown) => String(value ?? "").trim();
const formatNumber = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1));

const isPiiRequest = (message: string) => {
  const normalized = text(message).toLowerCase();
  const asksForData = /\b(show|list|give|get|find|display|query|lookup|what|which|who|export|download|provide|tell)\b/.test(normalized);
  const directIdentifier =
    /\b(pii|personal identifiers?|personal identification|ssn|social security(?: number)?|passport(?: number)?|driver'?s? licen[cs]e(?: number)?|license number|biometric(?: data)?|fingerprint|faceprint|retina|iris scan|aadhaar|national id|tax id|employee id|person id)\b/.test(
      normalized,
    );
  const indirectIdentifier =
    /\b(full legal names?|legal names?|full names?|date of birth|birth date|dob|phone numbers?|mobile numbers?|contact numbers?|telephone numbers?|personal emails?|email addresses?)\b/.test(
      normalized,
    );
  const addressIdentifier =
    /\b(home|mailing|residential|street|postal)\s+address(?:es)?\b/.test(normalized) ||
    (asksForData && /\b(address|addresses)\b/.test(normalized));

  return directIdentifier || indirectIdentifier || addressIdentifier;
};

const privacyBlockedRoute = () => ({
  intent: "privacy_restricted",
  confidence: "High",
  reason: "The question asks for direct or indirect personal identifiers.",
  executionMode: "blocked",
  plannedAgentPath: [],
  agentsToRun: [],
  skippedAgents: [
    "Workforce Router Agent",
    "Generic DB Query Tool",
    "Opportunity Assessment Tool",
    "Resource Supply Tool",
    "Team Builder Tool",
    "Risk & Insights Tool",
    "Approval & Decision Tool",
  ],
  executionPlan: [],
});

const requireDataset = (userId: string, datasetId: string): WorkforceDatasetRecord => {
  if (!userId || !datasetId) {
    throw new HttpError(400, "userId and datasetId are required.");
  }

  if (!getDummyUserById(userId)) {
    throw new HttpError(404, "Dataset not found.");
  }

  let dataset: WorkforceDatasetRecord;
  try {
    dataset = readDatasetRecord(datasetId);
  } catch {
    throw new HttpError(404, "Dataset not found.");
  }

  if (dataset.ownerUserId !== userId) {
    throw new HttpError(403, "Dataset does not belong to user.");
  }

  if (!existsSync(dataset.dbPath)) {
    throw new HttpError(404, "Dataset not found.");
  }

  return dataset;
};

const chooseDetailView = (message: string): WorkspaceDetailView => {
  const normalized = message.toLowerCase();
  if (/(ewa|approval|blocker|blocked|blocking|approval)/.test(normalized)) return "supply-risk";
  if (isNearMatchQuestion(message)) return "staffing-fit";
  if (/(skill gap|skills? gaps?|capabilit|accessibility|blueprint|interview)/.test(normalized)) return "skill-gaps";
  if (
    /(team|staff|fit|match|assign|coverage|confidence|feasible|fastest|balanced|best fit|recommended team|fte gap|cover|hardest|strongest)/.test(
      normalized,
    )
  ) {
    return "staffing-fit";
  }
  if (/(bench|supply|available|availability|capacity|people|candidate|candidates|partial-capacity|partial capacity)/.test(normalized)) {
    return "supply-risk";
  }
  if (/(demand|pipeline|opportunit|role|fte|delivery risk|priority|required|start dates?)/.test(normalized)) {
    return "demand";
  }
  return "staffing-fit";
};

const isEwaQuestion = (message: string) => /\b(ewa|approval|blocker|blocked|blocking)\b/i.test(message);
const isNearMatchQuestion = (message: string) => /\b(near[-\s]?match|near match|relax|relaxed|strict|fallback|closest)\b/i.test(message);
const isBenchTenureQuestion = (message: string) =>
  /\b(bench.*long|long.*bench|longest.*bench|bench.*longest|time on bench|bench tenure|bench days)\b/i.test(message);
const isBenchMovementQuestion = (message: string) =>
  /\b(bench movement|capacity outlook|trend|over time|timeline|next weeks|30\/60\/90|30 days|60 days|90 days)\b/i.test(message);
const isScenarioTargetQuestion = (message: string) =>
  /\b(scenario|target bench|bench target|bench rate|target rate|success measure)\b/i.test(message);
const isPeopleSkillLookupQuestion = (message: string) => {
  const asksForRowsOrCount = /\b(list|show|give|find|who|which|count|how many|number of|people|persons|employees?|resources?)\b/i.test(message);
  const asksForSkillEvidence = /\b(skill|skills|skilled|knows?|experience|experienced)\b/i.test(message);
  const asksPeopleWithValue =
    /\b(people|persons|employees?|resources?)\b/i.test(message) && /\bwith\b/i.test(message);
  return asksForRowsOrCount && (asksForSkillEvidence || asksPeopleWithValue);
};
const isGenericDatasetQueryQuestion = (message: string) => {
  const hasQueryAction = /\b(list|show|give|display|count|how many|number of|which|what|find|lookup|query)\b/i.test(message);
  const hasDatasetEntity =
    /\b(people|persons|employees?|resources?|skills?|skilled|skill catalog|profiles?|allocations?|bench|availability|opportunities?|roles?|overlays?|ewa|requests?|scenarios?|targets?|projects?|history|records?|rows?|tables?|grade|discipline|country|city|domain|client|stage)\b/i.test(
      message,
    );
  const asksPlanningExecution =
    /\b(staff|staffing|team|recommend|recommendation|approval package|ready for approval|highest priority|build|capacity outlook|bench movement|near[-\s]?match|needed|required)\b/i.test(
      message,
    );
  const directDataRequest = /\b(list|show|give|display|count|how many|number of|find|lookup|query|records?|rows?|tables?)\b/i.test(message);

  return isPeopleSkillLookupQuestion(message) || (hasQueryAction && hasDatasetEntity && (!asksPlanningExecution || directDataRequest));
};
const isPriorityAmbiguousQuestion = (message: string) =>
  /\b(top|highest priority|high priority)\b/i.test(message) && !/\b(internal ai workforce planner|banking contact centre ai assist|cloud cost optimisation platform|public sector case management|agentic commerce checkout accelerator)\b/i.test(message);
const shouldScopeSupplyToOpportunity = (message: string, view: WorkspaceDetailView) => {
  if (view !== "supply-risk") return true;
  return /\b(highest priority|top opportunity|selected opportunity|opportunity|demand|staff)\b/i.test(message);
};

const shouldReuseActiveOpportunity = (message: string, conversation: WorkforceConversationSummary) =>
  Boolean(conversation.activeOpportunityId) &&
  /\b(that|this|same|selected|current|previous|it|them|they|team|option|risk|risks|why|explain|details?|near[-\s]?match|near match)\b/i.test(
    message,
  ) &&
  !/\b(top|highest priority|high priority|new opportunity|another opportunity)\b/i.test(message);

const recentChatContext = (
  previousMessages: WorkforceConversationMessage[],
  userMessage: string,
): ChatContextMessage[] =>
  previousMessages
    .slice(-6)
    .map((message) => ({ role: message.role, content: message.content }))
    .concat({ role: "user", content: userMessage });

const objectRecord = (value: unknown) =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const genericDatasetQueryContract = (details: Record<string, unknown> | null | undefined) => {
  const detailRecord = objectRecord(details);
  const jsonRecord = objectRecord(detailRecord.json);
  const explicit = objectRecord(jsonRecord.genericDatasetQuery);
  if (text(explicit.tableName) || text(explicit.queryType)) return explicit;
  if (text(jsonRecord.tableName) || text(jsonRecord.queryType)) return jsonRecord;
  return {};
};

const lastGenericDatasetQueryContract = (messages: WorkforceConversationMessage[]) => {
  for (const message of [...messages].reverse()) {
    if (message.role !== "assistant" || message.detailView !== "table-query") continue;
    const contract = genericDatasetQueryContract(message.details);
    if (Object.keys(contract).length) return contract;
  }
  return {};
};

const genericFilterTerms = (contract: Record<string, unknown>) => {
  const filters = contract.filters;
  if (!Array.isArray(filters)) return [];
  return filters
    .map((filter) => {
      if (filter && typeof filter === "object") return text((filter as Record<string, unknown>).term);
      return text(filter);
    })
    .filter(Boolean);
};

const isBareGenericCountFollowUp = (message: string) => {
  const normalized = text(message).toLowerCase().replace(/[?.!]+/g, "").replace(/\s+/g, " ").trim();
  return (
    /^(how many|count|total)$/.test(normalized) ||
    /^(how many|count|total) (are )?(there|them|these|those|people|persons|employees|resources|rows|records)$/.test(normalized) ||
    /^number of (them|these|those|people|persons|employees|resources|rows|records)$/.test(normalized)
  );
};

const isBareGenericListFollowUp = (message: string) => {
  const normalized = text(message).toLowerCase().replace(/[?.!]+/g, "").replace(/\s+/g, " ").trim();
  return /^(show|list|display|view|show them|show those|show records|show rows|list them|list those|view details)$/.test(normalized);
};

const contextualGenericQueryMessage = (
  userMessage: string,
  previousMessages: WorkforceConversationMessage[],
) => {
  const wantsCount = isBareGenericCountFollowUp(userMessage);
  const wantsList = isBareGenericListFollowUp(userMessage);
  if (!wantsCount && !wantsList) return userMessage;

  const contract = lastGenericDatasetQueryContract(previousMessages);
  const tableName = text(contract.tableName);
  const tableDisplayName = text(contract.tableDisplayName) || tableName;
  if (!tableName && !tableDisplayName) return userMessage;

  const filterTerms = genericFilterTerms(contract);
  if (/PersonSkillEvidence/i.test(tableName) && filterTerms.length) {
    return wantsCount
      ? `how many people skilled in ${filterTerms.join(" and ")}`
      : `show people skilled in ${filterTerms.join(" and ")}`;
  }

  return `${wantsCount ? "count" : "show"} ${tableDisplayName || tableName}${filterTerms.length ? ` with ${filterTerms.join(" ")}` : ""}`;
};

const priorityClarification = (assessment: ReturnType<typeof assessOpportunity>) => {
  const highPriorityOptions = assessment.selectionDiagnostics.candidateOpportunities
    .filter((opportunity) => opportunity.commercialPriority === "High")
    .slice(0, 5);

  if (highPriorityOptions.length <= 1) {
    return null;
  }

  return `There are multiple high-priority opportunities: ${highPriorityOptions
    .map((opportunity) => opportunity.name)
    .join(", ")}. Which opportunity are you asking about?`;
};

const approvalDecisionUnavailableMessage =
  "I cannot answer EWA or approval-blocker questions yet because the Approval & Decision Tool is not implemented. Ask a staffing, supply, demand, or skill-gap question for now.";

const cleanResponseText = (value: string) =>
  text(value)
    .replace(/\*\*([A-Z][A-Za-z /&-]{2,28}):\*\*\s*/g, "$1: ")
    .replace(/\b(?:Snapshot|Recommendation|Recommended next steps|Next steps|Capacity risk|Demand|Risk|Open details|Role context|User role):\s*/gi, "")
    .replace(/\s*;\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();

const markdownBullets = (items: Array<string | null | undefined>) =>
  items
    .map((item) => cleanResponseText(item ?? ""))
    .filter(Boolean)
    .map((item) => `- ${item}`)
    .join("\n");

const ensureMarkdownBullets = (message: string) => {
  const normalized = text(message).trim();
  if (!normalized) {
    return normalized;
  }

  if (/^\s*(?:[-*]|\d+\.)\s+/m.test(normalized)) {
    const bulletLines = normalized
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*(?:[-*]|\d+\.)\s+/, "").trim())
      .filter(Boolean);

    return markdownBullets(bulletLines);
  }

  const lines = normalized
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+(?=[A-Z0-9])/))
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 5);

  return markdownBullets(lines.length ? lines : [normalized]);
};

const topTeamOption = (teamBuilder: ReturnType<typeof buildTeamOptions>) =>
  teamBuilder.teamOptions.find((option) => option.optionType === "Balanced Team") ?? teamBuilder.teamOptions[0] ?? null;

type BenchTenureCandidate = {
  personId?: string;
  name?: string;
  discipline?: string;
  availabilityCategory?: string;
  availableFrom?: string | null;
  availableFteInWindow?: number;
  benchRisk?: string | null;
  timeOnBenchDays?: number | null;
};

const benchTenureCandidates = (details: WorkspaceChatDetails): BenchTenureCandidate[] => {
  const supply = details.json.resourceSupply as
    | {
        candidates?: BenchTenureCandidate[];
        nearMatches?: BenchTenureCandidate[];
      }
    | undefined;
  const candidatesById = new Map<string, BenchTenureCandidate>();

  for (const candidate of [...(supply?.candidates ?? []), ...(supply?.nearMatches ?? [])]) {
    const key = candidate.personId || candidate.name;
    if (!key) continue;
    if (!candidatesById.has(key)) {
      candidatesById.set(key, candidate);
    }
  }

  return [...candidatesById.values()]
    .filter((candidate) => typeof candidate.timeOnBenchDays === "number")
    .sort((left, right) => (right.timeOnBenchDays ?? -1) - (left.timeOnBenchDays ?? -1))
    .slice(0, 10);
};

const buildDetails = ({
  view,
  assessment,
  supply,
  teamBuilder,
  skillGaps,
  ewaBlockers,
}: {
  view: WorkspaceDetailView;
  assessment: ReturnType<typeof assessOpportunity>;
  supply: ReturnType<typeof findResourceSupply>;
  teamBuilder: ReturnType<typeof buildTeamOptions>;
  skillGaps: ReturnType<typeof buildWorkforceDashboardSkillGaps>;
  ewaBlockers: EwaBlockerRow[];
}): WorkspaceChatDetails => {
  const selectedTeam = topTeamOption(teamBuilder);
  const selectedOpportunity = assessment.opportunity ?? teamBuilder.opportunity;
  const isGlobalSupplyView = view === "supply-risk" && !supply.filters.opportunityId;
  const contextName = isGlobalSupplyView ? "Global supply pool" : selectedOpportunity?.name ?? "Not selected";
  const cards: DetailCard[] = [
    {
      label: "Opportunity",
      value: contextName,
      detail: isGlobalSupplyView ? "Supply query is not scoped to a single opportunity." : assessment.selectionReason,
    },
    {
      label: "Required FTE",
      value: formatNumber(assessment.normalizedRequirements.totalFteRequired),
      detail: `${assessment.roles.length} roles detected`,
    },
    {
      label: "Candidates",
      value: String(supply.summary.totalCandidates),
      detail: `${supply.summary.availableInWindowFte.toFixed(1)} FTE in window`,
    },
    {
      label: "Team Gap",
      value: selectedTeam ? formatNumber(selectedTeam.remainingFteGap) : "n/a",
      detail: selectedTeam?.confidence ? `${selectedTeam.confidence} confidence` : "No team option selected",
    },
  ];

  const roleDemandChart: DetailChart = {
    type: "bar",
    title: "Role Demand",
    data: assessment.roles.slice(0, 8).map((role) => ({
      label: role.roleName,
      value: role.fteRequired,
      color: "#FF5640",
    })),
  };

  const supplyChart: DetailChart = {
    type: "bar",
    title: "Top Candidate Availability",
    data: supply.candidates.slice(0, 8).map((candidate) => ({
      label: candidate.name,
      value: candidate.availableFteInWindow,
      color: "#5899C4",
    })),
  };

  const capacityChart: DetailChart = {
    type: "bar",
    title: "Capacity by Release Window",
    data: supply.capacityByWindow.map((bucket) => ({
      label: bucket.window,
      value: bucket.fte,
      color: bucket.window === "Current" ? "#30A661" : "#5899C4",
    })),
  };

  const teamChart: DetailChart = {
    type: "bar",
    title: "Team Option Coverage",
    data: teamBuilder.teamOptions.map((option) => ({
      label: option.optionType.replace(" Team", ""),
      value: option.assignedFte,
      color: option.remainingFteGap > 0 ? "#F99C11" : "#30A661",
    })),
  };

  const gapChart: DetailChart = {
    type: "bar",
    title: "Required Skill Gaps",
    data: skillGaps.slice(0, 8).map((gap) => ({
      label: gap.skillName,
      value: gap.gap,
      color: "#FF5640",
    })),
  };

  const ewaStatusCounts = ewaBlockers.reduce<Record<string, number>>((counts, blocker) => {
    counts[blocker.ewaStatus] = (counts[blocker.ewaStatus] ?? 0) + 1;
    return counts;
  }, {});

  const ewaChart: DetailChart = {
    type: "bar",
    title: "EWA Blockers by Status",
    data: Object.entries(ewaStatusCounts).map(([label, value]) => ({
      label,
      value,
      color: label === "Blocked" ? "#FF5640" : "#F99C11",
    })),
  };

  const candidateTable: DetailTable = {
    title: "Top Candidates",
    headers: ["Person", "Discipline", "Available FTE", "Bench Days", "Score", "EWA"],
    rows: supply.candidates.slice(0, 10).map((candidate) => [
      candidate.name,
      candidate.discipline,
      formatNumber(candidate.availableFteInWindow),
      candidate.timeOnBenchDays == null ? "n/a" : String(candidate.timeOnBenchDays),
      String(candidate.overlayScore ?? candidate.skillMatchScore),
      candidate.ewaStatus,
    ]),
  };

  const roleTable: DetailTable = {
    title: "Opportunity Role Demand",
    headers: ["Role", "FTE", "Priority", "Start", "Required Skills"],
    rows: assessment.roles.slice(0, 10).map((role) => [
      role.roleName,
      formatNumber(role.fteRequired),
      role.priority,
      role.startDate,
      role.requiredSkills.slice(0, 4).join(", "),
    ]),
  };

  const teamTable: DetailTable = {
    title: "Balanced Team Assignments",
    headers: ["Role", "Person", "FTE", "Feasibility", "Score"],
    rows: (selectedTeam?.assignments ?? []).map((assignment) => [
      assignment.roleName,
      assignment.name,
      formatNumber(assignment.assignmentFte),
      assignment.feasibility,
      String(assignment.overallScore),
    ]),
  };

  const gapTable: DetailTable = {
    title: "No-Supply Skill Gaps",
    headers: ["Skill", "Required", "Supply", "Gap"],
    rows: skillGaps.map((gap) => [
      gap.skillName,
      String(gap.requiredRoles),
      String(gap.people),
      String(gap.gap),
    ]),
  };

  const nearMatchTable: DetailTable = {
    title: "Near-Match Candidates",
    headers: ["Person", "Discipline", "Available FTE", "Skill Score", "Reason"],
    rows: supply.nearMatches.slice(0, 10).map((candidate) => [
      candidate.name,
      candidate.discipline,
      formatNumber(candidate.availableFteInWindow),
      String(candidate.skillMatchScore),
      candidate.evidence[0] ?? "Near match from relaxed supply filters",
    ]),
  };

  const benchMovementTable: DetailTable = {
    title: "Bench Movement",
    headers: ["Week", "Current Bench", "Emerging Bench", "Partial Capacity", "Available FTE"],
    rows: supply.benchMovement.slice(0, 12).map((week) => [
      week.weekStartDate,
      String(week.currentBenchHeadcount),
      String(week.emergingBenchHeadcount),
      String(week.partialCapacityHeadcount),
      formatNumber(week.availableFte),
    ]),
  };

  const scenarioTargetTable: DetailTable = {
    title: "Scenario Targets",
    headers: ["Scenario", "Target Date", "Target Bench", "Current Bench", "Status"],
    rows: supply.scenarioTargets.slice(0, 8).map((target) => [
      target.scenarioName,
      target.targetDate,
      String(target.targetBenchHeadcount),
      target.currentBenchHeadcount == null ? "n/a" : String(target.currentBenchHeadcount),
      target.status,
    ]),
  };

  const ewaTable: DetailTable = {
    title: "EWA Blockers",
    headers: ["Opportunity", "Role", "Person", "Status", "Blocker", "Next Action"],
    rows: ewaBlockers.slice(0, 10).map((blocker) => [
      blocker.opportunityName,
      blocker.roleName,
      blocker.personName,
      blocker.ewaStatus,
      blocker.blockingReason,
      blocker.nextAction,
    ]),
  };

  const tables =
    view === "skill-gaps"
      ? [gapTable]
      : view === "supply-risk" && ewaBlockers.length
        ? [ewaTable, candidateTable, teamTable]
        : view === "supply-risk"
          ? [candidateTable, benchMovementTable, scenarioTargetTable, nearMatchTable]
        : view === "staffing-fit"
          ? [teamTable, candidateTable, nearMatchTable]
          : [roleTable, candidateTable, teamTable];
  const charts =
    view === "skill-gaps"
      ? [gapChart]
      : view === "demand"
        ? [roleDemandChart, teamChart]
        : view === "supply-risk" && ewaBlockers.length
          ? [ewaChart, supplyChart]
          : view === "supply-risk"
            ? [supplyChart, capacityChart]
            : [teamChart, supplyChart];

  return {
    view,
    title:
      view === "skill-gaps"
        ? "Skill Gap Evidence"
        : view === "demand"
          ? "Demand Evidence"
          : view === "supply-risk"
            ? "Supply Evidence"
            : "Staffing Fit Evidence",
    summary:
      selectedTeam?.summary ??
      `${supply.summary.totalCandidates} candidate(s) found for ${selectedOpportunity?.name ?? "the selected request"}.`,
    cards,
    charts,
    tables,
    json: {
      opportunityAssessment: assessment,
      resourceSupply: supply,
      teamBuilder,
      skillGaps,
      ewaBlockers,
    },
  };
};

const fallbackMessage = (userMessage: string, details: WorkspaceChatDetails) => {
  const opportunity = text(details.cards[0]?.value) || "the selected opportunity";
  const requiredFte = text(details.cards[1]?.value);
  const candidates = text(details.cards[2]?.value);
  const teamGap = text(details.cards[3]?.value);
  const assessment = details.json.opportunityAssessment as ReturnType<typeof assessOpportunity> | undefined;
  const supply = details.json.resourceSupply as ReturnType<typeof findResourceSupply> | undefined;
  const teamBuilder = details.json.teamBuilder as ReturnType<typeof buildTeamOptions> | undefined;
  const riskInsights = details.json.riskInsights as NonNullable<WorkforceRouterOutput["riskInsights"]> | undefined;
  const nearMatches = ((details.json.resourceSupply as { nearMatches?: Array<{
    name: string;
    discipline: string;
    availableFteInWindow: number;
    skillMatchScore: number;
    evidence: string[];
  }> } | undefined)?.nearMatches ?? []).slice(0, 5);

  if (isEwaQuestion(userMessage)) {
    return markdownBullets([
      approvalDecisionUnavailableMessage,
      "Open details to inspect the available staffing evidence before preparing approval.",
    ]);
  }

  if (isBenchTenureQuestion(userMessage)) {
    const benchCandidates = benchTenureCandidates(details);
    const longestBenchCandidate = benchCandidates[0] ?? null;

    if (!longestBenchCandidate) {
      return markdownBullets([
        "I could not find bench-tenure days in the supplied evidence.",
        "Open details to inspect current bench and availability records.",
      ]);
    }

    const runnerUpText = benchCandidates
      .slice(1, 4)
      .map((candidate) => `${candidate.name} (${candidate.timeOnBenchDays} days)`)
      .join(", ");

    return markdownBullets([
      `${longestBenchCandidate.name} has been on the bench the longest at ${longestBenchCandidate.timeOnBenchDays} days${longestBenchCandidate.availableFrom ? ` since ${longestBenchCandidate.availableFrom}` : ""}.`,
      runnerUpText ? `Next longest: ${runnerUpText}.` : "Open details to inspect the bench-tenure evidence.",
    ]);
  }

  if (isNearMatchQuestion(userMessage)) {
    if (!nearMatches.length) {
      return markdownBullets([
        "I did not find near-match candidates after relaxing strict filters.",
        "Open details to inspect the strict candidate set and filter diagnostics.",
      ]);
    }

    const names = nearMatches
      .slice(0, 3)
      .map((candidate) => `${candidate.name} (${candidate.discipline}, ${formatNumber(candidate.availableFteInWindow)} FTE, score ${candidate.skillMatchScore})`)
      .join(", ");

    return markdownBullets([
      `Strict matching can be supported by near-match candidates: ${names}.`,
      "Open details to inspect the near-match table, evidence, and filter diagnostics.",
    ]);
  }

  if (isScenarioTargetQuestion(userMessage) && supply?.scenarioTargets.length) {
    const targetLines = supply.scenarioTargets
      .slice(0, 3)
      .map((target) => {
        const currentBench =
          target.currentBenchHeadcount == null ? "no movement evidence" : `${target.currentBenchHeadcount} current bench`;
        const delta =
          target.currentBenchDelta == null
            ? ""
            : target.currentBenchDelta <= 0
              ? `, ${Math.abs(target.currentBenchDelta)} below target`
              : `, ${target.currentBenchDelta} above target`;
        return `${target.scenarioName}: target ${target.targetBenchHeadcount} by ${target.targetDate}, ${currentBench}${delta}`;
      })
      .join(". ");

    return markdownBullets([
      targetLines,
      "Open details to inspect focus, success measures, and the bench movement evidence used for target status.",
    ]);
  }

  if (isBenchMovementQuestion(userMessage) && supply?.benchMovement.length) {
    const firstWeek = supply.benchMovement[0];
    const lastWeek = supply.benchMovement[supply.benchMovement.length - 1];
    const fteDelta = Number((lastWeek.availableFte - firstWeek.availableFte).toFixed(2));
    const emergingDelta = lastWeek.emergingBenchHeadcount - firstWeek.emergingBenchHeadcount;

    return markdownBullets([
      `Bench movement runs from ${firstWeek.weekStartDate} to ${lastWeek.weekStartDate}.`,
      `Available FTE changes from ${formatNumber(firstWeek.availableFte)} to ${formatNumber(lastWeek.availableFte)} (${formatNumber(fteDelta)}), and emerging bench changes by ${emergingDelta}.`,
      "Open details to inspect the weekly trend.",
    ]);
  }

  if (details.view === "skill-gaps") {
    const gaps = (details.json.skillGaps as Array<{
      skillName: string;
      requiredRoles: number;
      people: number;
      gap: number;
    }> | undefined)?.slice(0, 5);
    const wantsExplanation = /\b(explain|why|details?|actions?|recommend|fix|solve)\b/i.test(userMessage);

    if (wantsExplanation && gaps?.length) {
      const gapLines = gaps
        .map((gap) => `${gap.skillName}: ${gap.requiredRoles} required role, ${gap.people} people with evidence, gap ${gap.gap}`)
        .join(". ");

      return markdownBullets([
        gapLines,
        "These are no-supply risks, so do not assign invented candidates.",
        "Use hiring, enablement/training, partner support, or EWA/escalation before committing those roles.",
      ]);
    }

    return gaps?.length
      ? markdownBullets([
          `I found no-supply skill gaps for ${gaps.map((gap) => gap.skillName).join(", ")}.`,
          "Open details to inspect the required demand, supply count, and gap evidence.",
        ])
      : markdownBullets(["I checked skill demand against workforce evidence and did not find positive skill gaps for this view."]);
  }

  if (riskInsights) {
    const topOptionRisk = riskInsights.optionAnalyses[0];
    const capabilityRisk = riskInsights.capabilityGaps[0]?.message;
    const availabilityRisk = riskInsights.availabilityRisks[0]?.message;

    return markdownBullets([
      riskInsights.summary ||
        `${riskInsights.opportunity?.name ?? opportunity} has ${riskInsights.overallRiskLevel} overall risk with ${riskInsights.overallConfidence} confidence.`,
      topOptionRisk
        ? `${topOptionRisk.optionType} is ${topOptionRisk.riskLevel} risk with score ${topOptionRisk.riskScore} and ${formatNumber(topOptionRisk.remainingFteGap)} FTE gap.`
        : null,
      capabilityRisk ?? availabilityRisk ?? "Open details to inspect capability, availability, and FTE-gap risk evidence.",
    ]);
  }

  if (details.view === "demand") {
    const roles = assessment?.roles.slice(0, 4) ?? [];
    const roleSummary = roles
      .map((role) => `${role.roleName} (${formatNumber(role.fteRequired)} FTE, starts ${role.startDate})`)
      .join(", ");

    return markdownBullets([
      `${opportunity} is the selected opportunity with ${requiredFte} required FTE across ${assessment?.roles.length ?? 0} role(s).`,
      roleSummary || "Open details to inspect the role demand.",
    ]);
  }

  if (details.view === "supply-risk") {
    if (supply?.filters.skills.length && (supply.filters.minFte === 0 || isPeopleSkillLookupQuestion(userMessage))) {
      const skills = supply.filters.skills.join(", ");
      const people = supply.candidates
        .slice(0, 8)
        .map((candidate) => `${candidate.name} (${candidate.discipline}, ${candidate.grade})`)
        .join(", ");

      return markdownBullets([
        `Found ${supply.summary.totalCandidates} people with ${skills} evidence in the uploaded dataset.`,
        people ? `People: ${people}.` : "No matching people were found in PersonSkillEvidence.",
        supply.summary.totalCandidates > 8 ? "Open details to inspect the rest of the matching people." : "Open details to inspect matched skills and availability context.",
      ]);
    }

    const topCandidates = supply?.candidates
      .slice(0, 3)
      .map((candidate) => `${candidate.name} (${formatNumber(candidate.availableFteInWindow)} FTE)`)
      .join(", ");

    return markdownBullets([
      `I found ${candidates} available candidate matches for ${opportunity}, with ${formatNumber(supply?.summary.availableInWindowFte ?? 0)} FTE in the planning window.`,
      topCandidates ? `Top matches: ${topCandidates}.` : "Open details to inspect supply evidence.",
    ]);
  }

  if (details.view === "staffing-fit") {
    const selectedTeam = teamBuilder ? topTeamOption(teamBuilder) : null;
    const teamType = selectedTeam?.optionType ?? "Balanced Team";
    const assignedFte = selectedTeam ? formatNumber(selectedTeam.assignedFte) : "0";

    return markdownBullets([
      `${teamType} for ${opportunity} covers ${assignedFte}/${requiredFte} FTE with ${teamGap} remaining FTE gap.`,
      "Open details to compare team options, assignments, candidate evidence, and near matches.",
    ]);
  }

  return markdownBullets([
    `For ${opportunity}, I found ${requiredFte} required FTE, ${candidates} candidate matches, and ${teamGap} remaining FTE gap.`,
    "Open details to inspect the charts and evidence.",
  ]);
};

const openAiMessage = async (
  userMessage: string,
  details: WorkspaceChatDetails,
  context: {
    conversation: WorkforceConversationSummary;
    recentMessages: ChatContextMessage[];
  },
) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return null;
  }

  const model = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";
  const evidence = {
    conversationMemory: {
      activeOpportunityId: context.conversation.activeOpportunityId,
      activeOpportunityName: context.conversation.activeOpportunityName,
      lastDetailView: context.conversation.lastDetailView,
      lastSummary: context.conversation.lastSummary,
    },
    recentMessages: context.recentMessages,
    view: details.view,
    title: details.title,
    deterministicSummary: details.summary,
    benchTenureCandidates: benchTenureCandidates(details).map((candidate) => ({
      name: candidate.name,
      discipline: candidate.discipline,
      availabilityCategory: candidate.availabilityCategory,
      availableFrom: candidate.availableFrom,
      availableFteInWindow: candidate.availableFteInWindow,
      benchRisk: candidate.benchRisk,
      timeOnBenchDays: candidate.timeOnBenchDays,
    })),
    cards: details.cards,
    tables: details.tables.map((table) => ({
      title: table.title,
      headers: table.headers,
      rows: table.rows.slice(0, 5),
    })),
  };

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content:
            "You are a workforce planning assistant. Return only Markdown bullets, usually 2-4 concise bullets. Keep each bullet natural and readable. Do not use section labels like Snapshot, Recommendation, Capacity risk, or Next steps unless the user explicitly asks for structured sections. Do not use semicolons to separate data, use commas or short sentences instead. Use only the supplied JSON evidence and recent chat context. Resolve follow-ups from conversationMemory when relevant. For bench-tenure questions, use benchTenureCandidates sorted by timeOnBenchDays. Do not invent names, scores, FTE, skills, or dates.",
        },
        {
          role: "user",
          content: JSON.stringify({ question: userMessage, evidence }),
        },
      ],
    }),
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as {
    output_text?: string;
    output?: Array<{
      content?: Array<{
        text?: string;
        type?: string;
      }>;
    }>;
  };
  const outputText =
    text(payload.output_text) ||
    text(
      payload.output
        ?.flatMap((item) => item.content ?? [])
        .map((content) => content.text)
        .filter(Boolean)
        .join("\n"),
    );

  return outputText || null;
};

const agentIdsByName: Record<string, string> = {
  "Opportunity Assessment Tool": "opportunity-assessment-tool",
  "Resource Supply Tool": "resource-supply-tool",
  "Team Builder Tool": "team-builder-tool",
  "Risk & Insights Tool": "risk-insights-tool",
  "Approval & Decision Tool": "approval-decision-tool",
  "Generic DB Query Tool": "generic-db-query-tool",
};

const toAgentIds = (agents: string[]) => [
  "workforce-router-agent",
  ...agents.map((agent) => agentIdsByName[agent] ?? agent.toLowerCase().replace(/\s+/g, "-")),
];

const buildRouterOpportunityDetails = (routerOutput: WorkforceRouterOutput): WorkspaceChatDetails | null => {
  const assessment = routerOutput.opportunityAssessment;
  if (!assessment) return null;

  const opportunity = assessment.opportunity;
  const cards: DetailCard[] = [
    {
      label: "Opportunity",
      value: opportunity?.name ?? assessment.selectedOpportunityId ?? "Not selected",
      detail: assessment.selectionReason,
    },
    {
      label: "Probability",
      value: opportunity ? `${Math.round(opportunity.probability * 100)}%` : "n/a",
      detail: opportunity ? `${opportunity.stage} stage, ${opportunity.commercialPriority} priority` : undefined,
    },
    {
      label: "Required FTE",
      value: formatNumber(assessment.normalizedRequirements.totalFteRequired),
      detail: `${assessment.roles.length} role(s) detected`,
    },
    {
      label: "Start",
      value: assessment.normalizedRequirements.startDate ?? opportunity?.expectedStartDate ?? "n/a",
      detail: assessment.normalizedRequirements.durationWeeks
        ? `${assessment.normalizedRequirements.durationWeeks} weeks`
        : undefined,
    },
  ];

  return {
    view: "demand",
    title: "Opportunity Assessment Evidence",
    summary: assessment.selectionReason,
    cards,
    charts: [
      {
        type: "bar",
        title: "Role Demand",
        data: assessment.roles.slice(0, 8).map((role) => ({
          label: role.roleName,
          value: role.fteRequired,
          color: "#FF5640",
        })),
      },
    ],
    tables: [
      {
        title: "Required Roles",
        headers: ["Role", "FTE", "Priority", "Grade", "Skills"],
        rows: assessment.roles.slice(0, 10).map((role) => [
          role.roleName,
          formatNumber(role.fteRequired),
          role.priority,
          role.gradePreference,
          role.requiredSkills.slice(0, 4).join(", "),
        ]),
      },
    ],
    json: {
      router: routerOutput.route,
      opportunityAssessment: assessment,
      evidence: routerOutput.evidence,
    },
  };
};

const buildRouterSupplyDetails = (routerOutput: WorkforceRouterOutput): WorkspaceChatDetails | null => {
  const supply = routerOutput.resourceSupply;
  if (!supply) return null;
  const isSkillEvidenceLookup = supply.filters.skills.length > 0 && supply.filters.minFte === 0;

  return {
    view: "supply-risk",
    title: isSkillEvidenceLookup ? "People Skill Evidence" : "Resource Supply Evidence",
    summary: isSkillEvidenceLookup
      ? `Found ${supply.summary.totalCandidates} people with ${supply.filters.skills.join(", ")} evidence.`
      : `Found ${supply.summary.totalCandidates} strict candidate(s), with ${formatNumber(
          supply.summary.availableInWindowFte,
        )} FTE available in the window.`,
    cards: [
      {
        label: isSkillEvidenceLookup ? "People" : "Candidates",
        value: String(supply.summary.totalCandidates),
        detail: isSkillEvidenceLookup
          ? supply.filters.skills.join(", ")
          : `${supply.nearMatches.length} near match(es) available`,
      },
      {
        label: "Current Bench",
        value: String(supply.summary.currentBenchPeople),
        detail: `${formatNumber(supply.summary.availableNowFte)} FTE now`,
      },
      {
        label: "Partial Capacity",
        value: String(supply.summary.partialCapacityPeople),
        detail: `${formatNumber(supply.summary.availableInWindowFte)} FTE in window`,
      },
      {
        label: isSkillEvidenceLookup ? "Filter" : "Window",
        value: isSkillEvidenceLookup ? "Skill evidence" : `${supply.filters.availabilityWindowDays} days`,
        detail: supply.filters.asOfDate,
      },
    ],
    charts: [
      {
        type: "bar",
        title: "Capacity by Release Window",
        data: supply.capacityByWindow.map((bucket) => ({
          label: bucket.window,
          value: bucket.fte,
          color: bucket.window === "Current" ? "#30A661" : "#5899C4",
        })),
      },
      {
        type: "bar",
        title: "Top Candidate Availability",
        data: supply.candidates.slice(0, 8).map((candidate) => ({
          label: candidate.name,
          value: candidate.availableFteInWindow,
          color: "#5899C4",
        })),
      },
      {
        type: "bar",
        title: "Bench Movement Available FTE",
        data: supply.benchMovement.slice(0, 12).map((week) => ({
          label: week.weekStartDate,
          value: week.availableFte,
          color: "#F99C11",
        })),
      },
    ],
    tables: [
      {
        title: isSkillEvidenceLookup ? "People With Skill Evidence" : "Top Candidates",
        headers: isSkillEvidenceLookup
          ? ["Person", "Discipline", "Grade", "Matched Skills", "Availability"]
          : ["Person", "Discipline", "Available FTE", "Bench Days", "Score", "EWA"],
        rows: supply.candidates.slice(0, 10).map((candidate) => [
          candidate.name,
          candidate.discipline,
          ...(isSkillEvidenceLookup
            ? [
                candidate.grade,
                candidate.matchedSkills.join(", "),
                `${formatNumber(candidate.availableFteInWindow)} FTE`,
              ]
            : [
                formatNumber(candidate.availableFteInWindow),
                candidate.timeOnBenchDays == null ? "n/a" : String(candidate.timeOnBenchDays),
                String(candidate.overlayScore ?? candidate.skillMatchScore),
                candidate.ewaStatus,
              ]),
        ]),
      },
      {
        title: "Near Matches",
        headers: ["Person", "Discipline", "Available FTE", "Skill Score", "Reason"],
        rows: supply.nearMatches.slice(0, 10).map((candidate) => [
          candidate.name,
          candidate.discipline,
          formatNumber(candidate.availableFteInWindow),
          String(candidate.skillMatchScore),
          candidate.evidence[0] ?? "Near match from relaxed supply filters",
        ]),
      },
      {
        title: "Bench Movement",
        headers: ["Week", "Current Bench", "Emerging Bench", "Partial Capacity", "Available FTE"],
        rows: supply.benchMovement.slice(0, 12).map((week) => [
          week.weekStartDate,
          String(week.currentBenchHeadcount),
          String(week.emergingBenchHeadcount),
          String(week.partialCapacityHeadcount),
          formatNumber(week.availableFte),
        ]),
      },
      {
        title: "Scenario Targets",
        headers: ["Scenario", "Target Date", "Target Bench", "Current Bench", "Status"],
        rows: supply.scenarioTargets.slice(0, 8).map((target) => [
          target.scenarioName,
          target.targetDate,
          String(target.targetBenchHeadcount),
          target.currentBenchHeadcount == null ? "n/a" : String(target.currentBenchHeadcount),
          target.status,
        ]),
      },
    ],
    json: {
      router: routerOutput.route,
      resourceSupply: supply,
      evidence: routerOutput.evidence,
    },
  };
};

const buildRouterTeamDetails = (routerOutput: WorkforceRouterOutput): WorkspaceChatDetails | null => {
  const teamBuilder = routerOutput.teamBuilder;
  if (!teamBuilder) return null;

  const selectedTeam =
    teamBuilder.teamOptions.find((option) => option.optionType === "Balanced Team") ?? teamBuilder.teamOptions[0] ?? null;
  const opportunity = teamBuilder.opportunity ?? routerOutput.opportunityAssessment?.opportunity ?? null;
  const totalFteRequired = selectedTeam?.totalFteRequired ?? teamBuilder.roleWiseCandidates.reduce((sum, role) => sum + role.fteRequired, 0);

  return {
    view: "staffing-fit",
    title: "Team Builder Evidence",
    summary: selectedTeam?.summary ?? routerOutput.message,
    cards: [
      {
        label: "Opportunity",
        value: opportunity?.name ?? "Selected opportunity",
        detail: opportunity ? `${opportunity.domain}, ${opportunity.country}` : undefined,
      },
      {
        label: "Required FTE",
        value: formatNumber(totalFteRequired),
        detail: `${teamBuilder.roleWiseCandidates.length} role(s)`,
      },
      {
        label: "Assigned FTE",
        value: selectedTeam ? formatNumber(selectedTeam.assignedFte) : "0",
        detail: selectedTeam?.confidence ? `${selectedTeam.confidence} confidence` : undefined,
      },
      {
        label: "Remaining Gap",
        value: selectedTeam ? formatNumber(selectedTeam.remainingFteGap) : formatNumber(totalFteRequired),
        detail: selectedTeam?.gaps[0] ?? "Compare team options for alternatives",
      },
    ],
    charts: [
      {
        type: "bar",
        title: "Team Option Coverage",
        data: teamBuilder.teamOptions.map((option) => ({
          label: option.optionType.replace(" Team", ""),
          value: option.assignedFte,
          color: option.remainingFteGap > 0 ? "#F99C11" : "#30A661",
        })),
      },
      {
        type: "bar",
        title: "Role Candidate Counts",
        data: teamBuilder.roleWiseCandidates.map((role) => ({
          label: role.roleName,
          value: role.candidates.length,
          color: role.candidates.length ? "#5899C4" : "#FF5640",
        })),
      },
    ],
    tables: [
      {
        title: "Balanced Team Assignments",
        headers: ["Role", "Person", "FTE", "Feasibility", "Score"],
        rows: (selectedTeam?.assignments ?? []).map((assignment) => [
          assignment.roleName,
          assignment.name,
          formatNumber(assignment.assignmentFte),
          assignment.feasibility,
          String(assignment.overallScore),
        ]),
      },
      {
        title: "Role Candidate Outcomes",
        headers: ["Role", "FTE", "Can Split", "Candidates", "Outcome"],
        rows: teamBuilder.roleWiseCandidates.map((role) => [
          role.roleName,
          formatNumber(role.fteRequired),
          role.canCombineCandidates ? "Yes" : "No",
          String(role.candidates.length),
          role.outcome,
        ]),
      },
    ],
    json: {
      router: routerOutput.route,
      opportunityAssessment: routerOutput.opportunityAssessment,
      resourceSupplyByRole: routerOutput.resourceSupplyByRole,
      teamBuilder,
      evidence: routerOutput.evidence,
    },
  };
};

const buildRouterRiskDetails = (routerOutput: WorkforceRouterOutput): WorkspaceChatDetails | null => {
  const riskInsights = routerOutput.riskInsights;
  if (!riskInsights) return null;

  return {
    view: "supply-risk",
    title: "Risk & Insights Evidence",
    summary: riskInsights.summary,
    cards: [
      {
        label: "Opportunity",
        value: riskInsights.opportunity?.name ?? "Selected opportunity",
        detail: riskInsights.opportunity ? `${riskInsights.opportunity.domain}, ${riskInsights.opportunity.country}` : undefined,
      },
      {
        label: "Overall Risk",
        value: riskInsights.overallRiskLevel,
        detail: `${riskInsights.overallConfidence} confidence`,
      },
      {
        label: "Capability Gaps",
        value: String(riskInsights.capabilityGaps.length),
        detail: riskInsights.capabilityGaps[0]?.message,
      },
      {
        label: "Availability Risks",
        value: String(riskInsights.availabilityRisks.length),
        detail: riskInsights.availabilityRisks[0]?.message,
      },
    ],
    charts: [
      {
        type: "bar",
        title: "Option Risk Score",
        data: riskInsights.optionAnalyses.map((option) => ({
          label: option.optionType.replace(" Team", ""),
          value: option.riskScore,
          color: option.riskLevel === "High" ? "#FF5640" : option.riskLevel === "Medium" ? "#F99C11" : "#30A661",
        })),
      },
      {
        type: "bar",
        title: "Regional Capacity Impact",
        data: riskInsights.regionalCapacityImpact.map((metric) => ({
          label: metric.label,
          value: metric.assignedFte,
          color: "#5899C4",
        })),
      },
    ],
    tables: [
      {
        title: "Option Risk Analysis",
        headers: ["Option", "Risk", "Confidence", "FTE Gap", "Action"],
        rows: riskInsights.optionAnalyses.map((option) => [
          option.optionType,
          option.riskLevel,
          option.confidence,
          formatNumber(option.remainingFteGap),
          option.recommendedActions[0] ?? "No action required",
        ]),
      },
      {
        title: "Role Risk Analysis",
        headers: ["Role", "Risk", "Best Candidate", "Capability", "Availability"],
        rows: riskInsights.roleAnalyses.map((role) => [
          role.roleName,
          role.riskLevel,
          role.bestCandidate ?? "n/a",
          role.capabilityGapSummary,
          role.availabilityRiskSummary,
        ]),
      },
    ],
    json: {
      router: routerOutput.route,
      opportunityAssessment: routerOutput.opportunityAssessment,
      teamBuilder: routerOutput.teamBuilder,
      riskInsights,
      evidence: routerOutput.evidence,
    },
  };
};

const buildRouterApprovalDetails = (routerOutput: WorkforceRouterOutput): WorkspaceChatDetails | null => {
  const approvalDecision = routerOutput.approvalDecision;
  if (!approvalDecision) return null;

  return {
    view: "supply-risk",
    title: "Approval Decision Evidence",
    summary: approvalDecision.recommendationSummary,
    cards: [
      {
        label: "Decision State",
        value: approvalDecision.decisionState,
        detail: approvalDecision.approvalPackage.recommendedDecision,
      },
      {
        label: "Ready",
        value: approvalDecision.readyForApproval ? "Yes" : "No",
        detail: approvalDecision.humanApprovalRequired ? "Human approval required" : "No human approval required",
      },
      {
        label: "Risk",
        value: approvalDecision.riskSummary.overallRiskLevel,
        detail: `${approvalDecision.riskSummary.overallConfidence} confidence`,
      },
      {
        label: "EWA Blockers",
        value: String(approvalDecision.ewaSummary.blockers.length),
        detail: `${approvalDecision.ewaSummary.totalRequests} request(s) reviewed`,
      },
    ],
    charts: [
      {
        type: "bar",
        title: "EWA Requests by Status",
        data: Object.entries(approvalDecision.ewaSummary.requestsByStatus).map(([label, value]) => ({
          label,
          value,
          color: label.toLowerCase().includes("blocked") ? "#FF5640" : "#5899C4",
        })),
      },
    ],
    tables: [
      {
        title: "Approval Checklist",
        headers: ["Item", "Status", "Notes"],
        rows: approvalDecision.approvalChecklist.map((item) => [item.item, item.status, item.notes.join("; ")]),
      },
      {
        title: "EWA Blockers",
        headers: ["Role", "Person", "Status", "FTE", "Next Action"],
        rows: approvalDecision.ewaSummary.blockers.map((blocker) => [
          blocker.roleName,
          blocker.personName,
          blocker.ewaStatus,
          formatNumber(blocker.requestedFte),
          blocker.nextAction,
        ]),
      },
      {
        title: "Decision Conditions",
        headers: ["Condition"],
        rows: approvalDecision.approvalPackage.conditions.map((condition) => [condition]),
      },
    ],
    json: {
      router: routerOutput.route,
      opportunityAssessment: routerOutput.opportunityAssessment,
      teamBuilder: routerOutput.teamBuilder,
      riskInsights: routerOutput.riskInsights,
      approvalDecision,
      evidence: routerOutput.evidence,
    },
  };
};

const genericDatasetQueryRoute = (queryOutput: GenericDatasetQueryOutput) => ({
  intent: "generic_dataset_query",
  confidence: queryOutput.confidence,
  reason: "The question asks for a generic dataset table lookup, count, or grouped breakdown.",
  executionMode: "tool_orchestrated",
  plannedAgentPath: ["Generic DB Query Tool"],
  agentsToRun: ["Generic DB Query Tool"],
  skippedAgents: [
    "Opportunity Assessment Tool",
    "Resource Supply Tool",
    "Team Builder Tool",
    "Risk & Insights Tool",
    "Approval & Decision Tool",
  ],
  executionPlan: [
    {
      order: 1,
      agent: "Generic DB Query Tool",
      purpose: "Map the user question to a validated dataset table and execute a safe read-only SELECT.",
      dependsOn: [],
    },
  ],
});

const buildGenericDatasetQueryDetails = (queryOutput: GenericDatasetQueryOutput): WorkspaceChatDetails => {
  const route = genericDatasetQueryRoute(queryOutput);
  const filterSummary = queryOutput.filters.map((filter) => filter.term).join(", ") || "No filters";
  const skillFilter = queryOutput.filters.find((filter) =>
    filter.columns.some((column) => /\bskill\b/i.test(column)),
  )?.term;
  const personFilterSummary = queryOutput.filters
    .filter((filter) => !filter.columns.some((column) => /\bskill\b/i.test(column)))
    .map((filter) => filter.term)
    .join(", ");
  const chartData =
    queryOutput.queryType === "group_count"
      ? queryOutput.rows.slice(0, 10).map((row) => ({
          label: row[0] || "Blank",
          value: Number(row[1] ?? 0) || 0,
          color: "#5899C4",
        }))
      : [];

  return {
    view: "table-query",
    title: "Dataset Query Evidence",
    summary:
      queryOutput.queryType === "count"
        ? queryOutput.tableName === "PersonSkillEvidence" && skillFilter
          ? `Counted ${queryOutput.totalMatchingRows} people with ${skillFilter} evidence${personFilterSummary ? ` matching ${personFilterSummary}` : ""}.`
          : `Counted ${queryOutput.totalMatchingRows} matching row(s) in ${queryOutput.tableDisplayName}.`
        : `Returned ${queryOutput.returnedRows} of ${queryOutput.totalMatchingRows} matching row(s) from ${queryOutput.tableDisplayName}.`,
    cards: [
      { label: "Table", value: queryOutput.tableDisplayName, detail: queryOutput.tableName },
      { label: "Rows", value: String(queryOutput.totalMatchingRows), detail: `${queryOutput.returnedRows} returned` },
      { label: "Query Type", value: queryOutput.queryType.replace("_", " "), detail: queryOutput.confidence },
      { label: "Filters", value: queryOutput.filters.length ? String(queryOutput.filters.length) : "0", detail: filterSummary },
    ],
    charts: chartData.length
      ? [
          {
            type: "bar",
            title: "Grouped Result Counts",
            data: chartData,
          },
        ]
      : [],
    tables: [
      {
        title: queryOutput.queryType === "group_count" ? "Grouped Query Results" : "Query Results",
        headers: queryOutput.headers,
        rows: queryOutput.rows,
      },
    ],
    json: {
      router: route,
      genericDatasetQuery: queryOutput,
      evidence: queryOutput.evidence,
    },
  };
};

const buildRouterDetails = (routerOutput: WorkforceRouterOutput): WorkspaceChatDetails | null => {
  if (routerOutput.approvalDecision) return buildRouterApprovalDetails(routerOutput);
  if (routerOutput.riskInsights) return buildRouterRiskDetails(routerOutput);
  if (routerOutput.teamBuilder) return buildRouterTeamDetails(routerOutput);
  if (routerOutput.resourceSupply) return buildRouterSupplyDetails(routerOutput);
  if (routerOutput.opportunityAssessment) return buildRouterOpportunityDetails(routerOutput);
  return null;
};

const formatRouterMessage = (routerOutput: WorkforceRouterOutput) =>
  markdownBullets([routerOutput.message]);

const withUserRoleContext = (message: string, _userRole: string | null) => message;

const routerResponse = (routerOutput: WorkforceRouterOutput, conversationId: string, userRole: string | null) => {
  const details = buildRouterDetails(routerOutput);
  return json({
    status: "success",
    conversationId,
    message: withUserRoleContext(formatRouterMessage(routerOutput), userRole),
    detailView: details?.view ?? null,
    details,
    agentsUsed: toAgentIds(routerOutput.route.plannedAgentPath),
    route: routerOutput.route,
  });
};

const piiRefusalMessage = () =>
  markdownBullets([
    "I can't provide direct or indirect personal identifiers such as SSNs, passport or driver's license numbers, biometric data, employee IDs, full legal names, dates of birth, addresses, phone numbers, or personal email addresses.",
    "Ask for aggregated counts, non-identifying summaries, or role/skill/availability evidence without personal identifiers.",
  ]);

const piiBlockedResponse = async (input: {
  userId: string;
  dataset?: WorkforceDatasetRecord | null;
  conversationId?: string | null;
  userMessage: string;
  userRole?: string | null;
}) => {
  const route = privacyBlockedRoute();
  const assistantMessage = withUserRoleContext(piiRefusalMessage(), input.userRole ?? null);

  if (!input.dataset) {
    return json({
      status: "success",
      conversationId: input.conversationId || `chat_${randomUUID()}`,
      message: assistantMessage,
      detailView: null,
      details: null,
      agentsUsed: [],
      route,
    });
  }

  const conversation = getOrCreateWorkforceConversation({
    conversationId: input.conversationId,
    userId: input.userId,
    datasetId: input.dataset.datasetId,
    firstMessage: input.userMessage,
  });

  appendWorkforceConversationMessage({
    conversationId: conversation.id,
    role: "user",
    content: input.userMessage,
  });
  appendWorkforceConversationMessage({
    conversationId: conversation.id,
    role: "assistant",
    content: assistantMessage,
    detailView: null,
    details: null,
  });
  updateWorkforceConversationMemory({
    conversationId: conversation.id,
    activeOpportunityId: null,
    activeOpportunityName: null,
    lastDetailView: null,
    lastSummary: assistantMessage,
  });

  return json({
    status: "success",
    conversationId: conversation.id,
    message: assistantMessage,
    detailView: null,
    details: null,
    agentsUsed: [],
    route,
  });
};

const persistedRouterResponse = async (
  routerOutput: WorkforceRouterOutput,
  input: {
    userId: string;
    dataset: WorkforceDatasetRecord;
    conversationId?: string | null;
    userMessage: string;
    userRole?: string | null;
  },
) => {
  const conversation = getOrCreateWorkforceConversation({
    conversationId: input.conversationId,
    userId: input.userId,
    datasetId: input.dataset.datasetId,
    firstMessage: input.userMessage,
  });
  const details = buildRouterDetails(routerOutput);
  const existingConversation = readWorkforceConversation({
    conversationId: conversation.id,
    userId: input.userId,
    datasetId: input.dataset.datasetId,
  });
  const modelMessage = details
    ? await openAiMessage(input.userMessage, details, {
        conversation,
        recentMessages: recentChatContext(existingConversation.messages, input.userMessage),
      })
    : null;
  const deterministicMessage = details ? fallbackMessage(input.userMessage, details) : formatRouterMessage(routerOutput);
  const assistantMessage = withUserRoleContext(
    modelMessage ? ensureMarkdownBullets(modelMessage) : deterministicMessage,
    input.userRole ?? null,
  );

  appendWorkforceConversationMessage({
    conversationId: conversation.id,
    role: "user",
    content: input.userMessage,
  });
  appendWorkforceConversationMessage({
    conversationId: conversation.id,
    role: "assistant",
    content: assistantMessage,
    detailView: details?.view ?? null,
    details: details ? { ...details } : null,
  });
  updateWorkforceConversationMemory({
    conversationId: conversation.id,
    activeOpportunityId: routerOutput.opportunityAssessment?.opportunity?.id ?? null,
    activeOpportunityName: routerOutput.opportunityAssessment?.opportunity?.name ?? null,
    lastDetailView: details?.view ?? null,
    lastSummary: assistantMessage,
  });

  return json({
    status: "success",
    conversationId: conversation.id,
    message: assistantMessage,
    detailView: details?.view ?? null,
    details,
    agentsUsed: toAgentIds(routerOutput.route.plannedAgentPath),
    route: routerOutput.route,
  });
};

const genericDatasetQueryMessage = (details: WorkspaceChatDetails) =>
  markdownBullets([
    details.summary,
    "Open details to inspect the generated query plan, result table, and raw JSON contract.",
  ]);

const persistedGenericDatasetQueryResponse = async (
  queryOutput: GenericDatasetQueryOutput,
  input: {
    userId: string;
    dataset: WorkforceDatasetRecord;
    conversationId?: string | null;
    userMessage: string;
    userRole?: string | null;
  },
) => {
  const conversation = getOrCreateWorkforceConversation({
    conversationId: input.conversationId,
    userId: input.userId,
    datasetId: input.dataset.datasetId,
    firstMessage: input.userMessage,
  });
  const details = buildGenericDatasetQueryDetails(queryOutput);
  const assistantMessage = withUserRoleContext(genericDatasetQueryMessage(details), input.userRole ?? null);

  appendWorkforceConversationMessage({
    conversationId: conversation.id,
    role: "user",
    content: input.userMessage,
  });
  appendWorkforceConversationMessage({
    conversationId: conversation.id,
    role: "assistant",
    content: assistantMessage,
    detailView: details.view,
    details: { ...details },
  });
  updateWorkforceConversationMemory({
    conversationId: conversation.id,
    activeOpportunityId: null,
    activeOpportunityName: null,
    lastDetailView: details.view,
    lastSummary: assistantMessage,
  });

  const route = genericDatasetQueryRoute(queryOutput);
  return json({
    status: "success",
    conversationId: conversation.id,
    message: assistantMessage,
    detailView: details.view,
    details,
    agentsUsed: toAgentIds(route.plannedAgentPath),
    route,
  });
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as WorkspaceChatRequest;
    const userId = text(body.userId);
    const datasetId = text(body.datasetId);
    const requestConversationId = text(body.conversationId);
    const userMessage = text(body.message);
    const conversationId = requestConversationId || `chat_${randomUUID()}`;
    const user = userId ? getDummyUserById(userId) : null;
    const userRole = user?.role ?? null;

    if (!userMessage) {
      throw new HttpError(400, "message is required.");
    }

    if (isPiiRequest(userMessage)) {
      const dataset = datasetId ? requireDataset(userId, datasetId) : null;
      return await piiBlockedResponse({
        userId,
        dataset,
        conversationId: requestConversationId,
        userMessage,
        userRole,
      });
    }

    const initialRouterOutput = routeWorkforceQuestion({
      userQuestion: userMessage,
      query: userMessage,
      resourceSupplyLimit: 10,
      limitPerRole: 5,
    });

    if (!datasetId) {
      return routerResponse(initialRouterOutput, conversationId, userRole);
    }

    const dataset = requireDataset(userId, datasetId);
    let previousMessages: WorkforceConversationMessage[] = [];
    if (requestConversationId) {
      try {
        previousMessages = readWorkforceConversation({
          conversationId: requestConversationId,
          userId,
          datasetId,
        }).messages;
      } catch {
        previousMessages = [];
      }
    }
    const genericQueryMessage = contextualGenericQueryMessage(userMessage, previousMessages);

    if (
      genericQueryMessage === userMessage &&
      (initialRouterOutput.route.executionMode === "no_db_required" ||
        initialRouterOutput.route.executionMode === "blocked")
    ) {
      return await persistedRouterResponse(initialRouterOutput, {
        userId,
        dataset,
        conversationId: requestConversationId,
        userMessage,
        userRole,
      });
    }

    const shouldRunGenericQuery =
      genericQueryMessage !== userMessage ||
      isGenericDatasetQueryQuestion(genericQueryMessage) ||
      (initialRouterOutput.route.executionMode === "clarification" && !isBareGenericListFollowUp(userMessage));

    if (shouldRunGenericQuery) {
      try {
        const genericQueryOutput = queryGenericDataset({
          datasetId: dataset.datasetId,
          query: genericQueryMessage,
          limit: 25,
        });
        return await persistedGenericDatasetQueryResponse(genericQueryOutput, {
          userId,
          dataset,
          conversationId: requestConversationId,
          userMessage,
          userRole,
        });
      } catch (error) {
        if (genericQueryMessage !== userMessage || isGenericDatasetQueryQuestion(genericQueryMessage)) {
          throw error;
        }
      }
    }

    if (initialRouterOutput.route.executionMode === "clarification") {
      return await persistedRouterResponse(initialRouterOutput, {
        userId,
        dataset,
        conversationId: requestConversationId,
        userMessage,
        userRole,
      });
    }

    const routerOutput = routeWorkforceQuestion({
      datasetId: dataset.datasetId,
      userQuestion: userMessage,
      query: userMessage,
      resourceSupplyLimit: 10,
      limitPerRole: 5,
    });

    return await persistedRouterResponse(routerOutput, {
      userId,
      dataset,
      conversationId: requestConversationId,
      userMessage,
      userRole,
    });
  } catch (error) {
    if (error instanceof HttpError) {
      return json({ status: "failure", error: error.message }, error.statusCode);
    }

    const message = error instanceof Error ? error.message : "Failed to answer workforce question.";
    return json({ status: "failure", error: message }, 500);
  }
}
