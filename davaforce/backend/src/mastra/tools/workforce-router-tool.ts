import { createTool } from "@mastra/core/tools";
import { buildApprovalDecision } from "./approval-decision-tool";
import { assessOpportunity } from "./opportunity-assessment-tool";
import { findResourceSupply } from "./resource-supply-tool";
import { buildRiskInsights } from "./risk-insights-tool";
import { buildTeamOptions } from "./team-builder-tool";
import {
  workforceRouterInputSchema,
  workforceRouterOutputSchema,
  type ApprovalDecisionInput,
  type OpportunityAssessmentOutput,
  type WorkforceRouterInput,
  type WorkforceRouterOutput,
} from "../schemas/workforce-planning-schemas";

type RouterIntent = WorkforceRouterOutput["route"]["intent"];
type ExecutionStep = WorkforceRouterOutput["route"]["executionPlan"][number];

const SPECIALIST_TOOLS = [
  "Opportunity Assessment Tool",
  "Resource Supply Tool",
  "Team Builder Tool",
  "Risk & Insights Tool",
  "Approval & Decision Tool",
];

const includesAny = (value: string, terms: string[]) => terms.some((term) => value.includes(term));
const explicitOpportunityId = (value: string) => value.match(/\bOPP-\d+\b/i)?.[0].toUpperCase();

const isGenericQuestion = (value: string) => {
  const normalized = value.trim().toLowerCase();
  return /^(hi|hii|hello|hey|heyy|yo|thanks|thank you|ok|okay|help|what can you do)[!.?\s]*$/.test(normalized);
};

const asksTeamConstruction = (value: string) =>
  /\b(build|create|compose|assemble|construct|form|recommend|suggest|staff|assign)\b.{0,80}\b(team|staffing option|staffing options|staffing plan)\b/i.test(
    value,
  ) ||
  /\b(team|staffing option|staffing options|staffing plan)\b.{0,80}\b(best|balanced|fastest|strongest|recommend|option|assign|coverage|cover)\b/i.test(
    value,
  ) ||
  /\bassign\s+people\s+to\s+roles\b/i.test(value);

const isUnsafeRequest = (value: string) =>
  /\b(auto[-\s]?approve|approve booking|approve ewa|bypass approval|bypass ewa|delete|drop table|force approve|ignore approval|mark approved|modify db|override approval|update booking|write to db)\b/i.test(
    value,
  );

const asksUnsupportedEvidenceField = (value: string) =>
  /\b(salary|compensation|ctc|pay|passport|personal email|personal e-mail|private email|phone number|mobile number)\b/i.test(value);

const asksPeopleSkillLookup = (value: string) =>
  /\b(list|show|give|find|who|which|people|persons|employees?|resources?)\b/i.test(value) &&
  /\b(skill|skills|skilled|knows?|experience|experienced|with)\b/i.test(value);

const classifyIntent = (input: WorkforceRouterInput) => {
  if (input.intentOverride) {
    return {
      intent: input.intentOverride,
      confidence: "High",
      reason: `Intent override supplied: ${input.intentOverride}.`,
    };
  }

  const question = `${input.query ?? ""} ${input.userQuestion}`.toLowerCase();
  const hasOpportunityId = Boolean(explicitOpportunityId(question));

  if (isUnsafeRequest(question)) {
    return {
      intent: "blocked" as const,
      confidence: "High",
      reason: "The user asked for an unsafe or out-of-scope action such as modifying records, bypassing approval, or auto-approving bookings.",
    };
  }

  if (isGenericQuestion(input.userQuestion) && (!input.query || isGenericQuestion(input.query))) {
    return {
      intent: "general" as const,
      confidence: "High",
      reason: "The user sent a greeting or general help message, so no database-backed staffing route is needed.",
    };
  }

  if (
    includesAny(question, [
      "approval",
      "approval package",
      "approve",
      "approver",
      "blocker",
      "blockers",
      "booking",
      "complete recommendation",
      "condition",
      "conditions",
      "decision",
      "decision package",
      "decision summary",
      "ewa",
      "final recommendation",
      "full recommendation",
      "human approval",
      "ready for approval",
    ])
  ) {
    return {
      intent: "approval_decision" as const,
      confidence: "High",
      reason: "The question asks for approval, EWA, booking readiness, or final decision packaging.",
    };
  }

  if (
    includesAny(question, [
      "capability gap",
      "confidence",
      "delivery risk",
      "gap analysis",
      "insight",
      "risk",
      "utilization impact",
    ])
  ) {
    return {
      intent: "risk_insights" as const,
      confidence: "High",
      reason: "The question asks for risk, confidence, gaps, or impact analysis.",
    };
  }

  if (
    asksTeamConstruction(question) ||
    includesAny(question, [
      "balanced team",
      "best fit",
      "best team",
      "build team",
      "create a team",
      "create team",
      "fastest available",
      "multiple roles",
      "recommend a team",
      "recommend team",
      "recommended team",
      "staffing option",
      "staffing options",
      "staffing plan",
      "team builder",
      "team option",
      "team options",
    ])
  ) {
    return {
      intent: "team_builder" as const,
      confidence: "High",
      reason: "The question asks for team construction or staffing options.",
    };
  }

  if (
    asksPeopleSkillLookup(question) ||
    includesAny(question, [
      "30 days",
      "60 days",
      "90 days",
      "available",
      "availability",
      "bench",
      "candidate",
      "candidates",
      "capacity",
      "find people",
      "list people",
      "people with skill",
      "partial capacity",
      "resource supply",
      "supply",
    ])
  ) {
    return {
      intent: "resource_supply" as const,
      confidence: "Medium",
      reason: "The question asks about available people, bench, candidates, or workforce capacity.",
    };
  }

  if (
    includesAny(question, [
      "demand",
      "highest probability",
      "opportunity",
      "probability",
      "required role",
      "required roles",
      "requirement",
      "requirements",
      "roles needed",
    ])
  ) {
    return {
      intent: "opportunity_assessment" as const,
      confidence: "Medium",
      reason: "The question asks about opportunity demand, probability, requirements, or required roles.",
    };
  }

  if (
    hasOpportunityId &&
    includesAny(question, [
      "architect",
      "best",
      "candidate",
      "fit",
      "match",
      "person",
      "salary",
      "staff",
      "who",
    ])
  ) {
    return {
      intent: "team_builder" as const,
      confidence: "Medium",
      reason: "The question names an opportunity and asks for candidate or staffing evidence.",
    };
  }

  return {
    intent: "clarification" as const,
    confidence: "Low",
    reason: "No clear staffing execution intent was detected.",
  };
};

const toolsForIntent = (intent: RouterIntent) => {
  if (intent === "blocked" || intent === "clarification") {
    return [];
  }
  if (intent === "general") {
    return [];
  }
  if (intent === "opportunity_assessment") {
    return ["Opportunity Assessment Tool"];
  }
  if (intent === "resource_supply") {
    return ["Resource Supply Tool"];
  }
  if (intent === "team_builder") {
    return ["Opportunity Assessment Tool", "Resource Supply Tool", "Team Builder Tool"];
  }
  if (intent === "risk_insights") {
    return ["Opportunity Assessment Tool", "Resource Supply Tool", "Team Builder Tool", "Risk & Insights Tool"];
  }
  return SPECIALIST_TOOLS;
};

const planForIntent = (intent: RouterIntent): ExecutionStep[] => {
  const tools = toolsForIntent(intent);
  const plan: ExecutionStep[] = [];

  if (tools.includes("Opportunity Assessment Tool")) {
    plan.push({
      order: plan.length + 1,
      agent: "Opportunity Assessment Tool",
      purpose: "Normalize demand into opportunity, roles, skills, location, timeline, and FTE requirements.",
      dependsOn: [],
    });
  }

  if (tools.includes("Resource Supply Tool")) {
    plan.push({
      order: plan.length + 1,
      agent: "Resource Supply Tool",
      purpose:
        intent === "resource_supply"
          ? "Answer the supply question directly using availability, bench, skills, capacity, and EWA evidence."
          : "Find supply for each assessed opportunity role before team construction.",
      dependsOn: intent === "resource_supply" ? [] : ["Opportunity Assessment Tool"],
    });
  }

  if (tools.includes("Team Builder Tool")) {
    plan.push({
      order: plan.length + 1,
      agent: "Team Builder Tool",
      purpose: "Combine assessed demand and role-wise supply into Best Fit, Fastest Available, and Balanced team options.",
      dependsOn: ["Opportunity Assessment Tool", "Resource Supply Tool"],
    });
  }

  if (tools.includes("Risk & Insights Tool")) {
    plan.push({
      order: plan.length + 1,
      agent: "Risk & Insights Tool",
      purpose: "Evaluate team options for confidence, capability gaps, availability risk, FTE gaps, and impact.",
      dependsOn: ["Team Builder Tool"],
    });
  }

  if (tools.includes("Approval & Decision Tool")) {
    plan.push({
      order: plan.length + 1,
      agent: "Approval & Decision Tool",
      purpose: "Prepare the human approval package with EWA status, blockers, conditions, and next actions.",
      dependsOn: ["Risk & Insights Tool"],
    });
  }

  return plan;
};

const baseQuery = (input: WorkforceRouterInput) => input.query ?? input.userQuestion;

const selectedOpportunityInput = (
  input: WorkforceRouterInput,
  assessment: OpportunityAssessmentOutput | null,
): ApprovalDecisionInput => ({
  datasetId: input.datasetId,
  dbPath: input.dbPath,
  opportunityId: assessment?.selectedOpportunityId ?? input.opportunityId,
  query: baseQuery(input),
  asOfDate: input.asOfDate ?? assessment?.asOfDate,
  availabilityWindowDays: input.availabilityWindowDays,
  limitPerRole: input.limitPerRole ?? 5,
  preferredOptionType: input.preferredOptionType,
});

const finalResponseTypeFor = (intent: RouterIntent) => {
  if (intent === "blocked") return "blocked_message";
  if (intent === "clarification") return "clarification_message";
  if (intent === "general") return "general_message";
  if (intent === "opportunity_assessment") return "opportunity_assessment_json";
  if (intent === "resource_supply") return "resource_supply_json";
  if (intent === "team_builder") return "team_builder_json";
  if (intent === "risk_insights") return "risk_insights_json";
  return "approval_decision_json";
};

const genericMessage =
  "Hi! I can help with opportunity assessment, resource supply, team building, risk insights, and approval packages. For DB-backed analysis, send a workforce question with a datasetId or DB path.";

const blockedMessage =
  "I can prepare evidence-backed staffing recommendations and approval packages, but I cannot modify records, bypass EWA, approve bookings, or mark staffing decisions as completed.";

const clarificationMessage =
  "I can help with opportunity assessment, resource supply, team building, risk insights, or approval packages. Which of those would you like to run?";

const needsContextMessage = (intent: RouterIntent) =>
  `I can route this as ${intent}, but I need a datasetId or dbPath before I can query workforce data. Please provide the dataset ID or SQLite DB path with the question.`;

const unsupportedEvidenceMessage = (fields: string[], opportunityId: string | null) =>
  `I could not answer the unsupported field request from the workforce dataset. ${
    opportunityId ? `${opportunityId} was checked as the requested opportunity context. ` : ""
  }The dataset tools can provide staffing evidence such as roles, skills, availability, FTE, fit scores, and EWA status, but not ${fields.join(
    ", ",
  )}.`;

const opportunityNotFoundMessage = (opportunityId: string, unsupportedFields: string[]) =>
  `I could not find ${opportunityId} in the selected dataset, so I cannot identify candidates or staffing evidence for that opportunity. ${
    unsupportedFields.length > 0
      ? `Also, ${unsupportedFields.join(", ")} is not available from the workforce evidence tools.`
      : "Please check the opportunity ID or ask about an opportunity that exists in the dataset."
  }`;

const outputGuardrailEvidence = [
  "Output guardrail: response content is limited to deterministic router/tool output and supplied DB evidence; no additional evidence was invented.",
  "Output guardrail: recommendations are advisory only; no approval, booking, EWA update, allocation update, or database write was executed.",
];

const sanitizeAutoApprovalLanguage = (message: string) =>
  message
    .replace(/\b(auto[-\s]?approved|automatically approved)\b/gi, "prepared for human approval review")
    .replace(/\b(approved successfully|successfully approved|has been approved|is approved)\b/gi, "ready for human approval review")
    .replace(/\b(booking confirmed|confirmed booking|has been booked|is booked)\b/gi, "prepared for booking review")
    .replace(/\b(marked completed|has been completed|is completed|completed successfully)\b/gi, "prepared for human review");

const applyOutputGuardrails = (output: WorkforceRouterOutput): WorkforceRouterOutput => {
  const sanitizedMessage = sanitizeAutoApprovalLanguage(output.message);
  const sanitizedEvidence =
    sanitizedMessage === output.message ? [] : ["Output guardrail: auto-approval or booking-completion wording was converted to human-review wording."];

  return {
    ...output,
    message: sanitizedMessage,
    evidence: [...output.evidence, ...outputGuardrailEvidence, ...sanitizedEvidence],
  };
};

export function routeWorkforceQuestion(input: WorkforceRouterInput): WorkforceRouterOutput {
  const classified = classifyIntent(input);
  const intent = classified.intent;
  const query = baseQuery(input);
  const extractedOpportunityId = input.opportunityId ?? explicitOpportunityId(query);
  const unsupportedFields = asksUnsupportedEvidenceField(query)
    ? [
        /\b(salary|compensation|ctc|pay)\b/i.test(query) ? "salary or compensation" : null,
        /\b(passport)\b/i.test(query) ? "passport details" : null,
        /\b(personal email|personal e-mail|private email)\b/i.test(query) ? "personal email" : null,
        /\b(phone number|mobile number)\b/i.test(query) ? "phone number" : null,
      ].filter((field): field is string => Boolean(field))
    : [];
  const toolsToRun = toolsForIntent(intent);
  const baseRoute = {
    intent,
    confidence: classified.confidence,
    reason: classified.reason,
    plannedAgentPath: toolsToRun,
    agentsToRun: toolsToRun,
    skippedAgents: SPECIALIST_TOOLS.filter((tool) => !toolsToRun.includes(tool)),
    executionPlan: planForIntent(intent),
  };

  if (intent === "blocked") {
    return applyOutputGuardrails({
      route: {
        ...baseRoute,
        executionMode: "blocked",
      },
      opportunityAssessment: null,
      resourceSupply: null,
      resourceSupplyByRole: [],
      teamBuilder: null,
      riskInsights: null,
      approvalDecision: null,
      finalResponseType: finalResponseTypeFor(intent),
      message: blockedMessage,
      evidence: [
        "Router blocked the request because it asked for an unsafe or out-of-scope action.",
        "No database-backed tool execution was attempted.",
      ],
    });
  }

  if (intent === "clarification") {
    return applyOutputGuardrails({
      route: {
        ...baseRoute,
        executionMode: "clarification",
      },
      opportunityAssessment: null,
      resourceSupply: null,
      resourceSupplyByRole: [],
      teamBuilder: null,
      riskInsights: null,
      approvalDecision: null,
      finalResponseType: finalResponseTypeFor(intent),
      message: clarificationMessage,
      evidence: [
        "Router could not classify the request into a clear workforce planning route.",
        "No database-backed tool execution was attempted.",
      ],
    });
  }

  if (intent === "general") {
    return applyOutputGuardrails({
      route: {
        ...baseRoute,
        executionMode: "no_db_required",
      },
      opportunityAssessment: null,
      resourceSupply: null,
      resourceSupplyByRole: [],
      teamBuilder: null,
      riskInsights: null,
      approvalDecision: null,
      finalResponseType: finalResponseTypeFor(intent),
      message: genericMessage,
      evidence: [
        "Router classified the message as a general greeting/help request.",
        "No database-backed route was needed.",
      ],
    });
  }

  if (!input.datasetId && !input.dbPath) {
    return applyOutputGuardrails({
      route: {
        ...baseRoute,
        executionMode: "needs_context",
        reason: `${classified.reason} A datasetId or dbPath is required before running DB-backed tools.`,
      },
      opportunityAssessment: null,
      resourceSupply: null,
      resourceSupplyByRole: [],
      teamBuilder: null,
      riskInsights: null,
      approvalDecision: null,
      finalResponseType: "needs_context_message",
      message: needsContextMessage(intent),
      evidence: [
        `Router classified the question as ${intent} with ${classified.confidence} confidence.`,
        "No datasetId or dbPath was provided, so no database-backed tool execution was attempted.",
      ],
    });
  }

  const assessmentNeeded = intent !== "resource_supply";
  const teamNeeded = intent === "team_builder" || intent === "risk_insights" || intent === "approval_decision";
  const riskNeeded = intent === "risk_insights" || intent === "approval_decision";
  const approvalNeeded = intent === "approval_decision";
  const opportunityAssessment = assessmentNeeded
    ? assessOpportunity({
        datasetId: input.datasetId,
        dbPath: input.dbPath,
        opportunityId: extractedOpportunityId,
        query,
        asOfDate: input.asOfDate,
      })
    : null;
  const opportunityId = opportunityAssessment?.selectedOpportunityId ?? extractedOpportunityId;
  const asOfDate = input.asOfDate ?? opportunityAssessment?.asOfDate;

  if (extractedOpportunityId && opportunityAssessment && !opportunityAssessment.selectedOpportunityId) {
    return applyOutputGuardrails({
      route: {
        ...baseRoute,
        executionMode: "tool_orchestrated",
      },
      opportunityAssessment,
      resourceSupply: null,
      resourceSupplyByRole: [],
      teamBuilder: null,
      riskInsights: null,
      approvalDecision: null,
      finalResponseType: finalResponseTypeFor("opportunity_assessment"),
      message: opportunityNotFoundMessage(extractedOpportunityId, unsupportedFields),
      evidence: [
        `Router classified the question as ${intent} with ${classified.confidence} confidence.`,
        `Explicit opportunity ID ${extractedOpportunityId} was requested but was not found in the dataset.`,
        unsupportedFields.length > 0
          ? `Unsupported field request detected: ${unsupportedFields.join(", ")} is not returned by workforce evidence tools.`
          : "No unsupported private or compensation field was requested.",
        "No candidate, salary, or staffing recommendation was invented.",
      ],
    });
  }

  const resourceSupply =
    intent === "resource_supply"
      ? findResourceSupply({
          datasetId: input.datasetId,
          dbPath: input.dbPath,
          query,
          opportunityId: extractedOpportunityId,
          roleId: input.roleId,
          skills: input.skills,
          roleName: input.roleName,
          discipline: input.discipline,
          grade: input.grade,
          location: input.location,
          domain: input.domain,
          asOfDate: input.asOfDate,
          availabilityWindowDays: input.availabilityWindowDays,
          minFte: input.minFte,
          limit: input.resourceSupplyLimit ?? 20,
        })
      : null;
  const resourceSupplyByRole =
    opportunityAssessment && intent !== "opportunity_assessment"
      ? opportunityAssessment.roles.map((role) => ({
          roleId: role.id,
          roleName: role.roleName,
          resourceSupply: findResourceSupply({
            datasetId: input.datasetId,
            dbPath: input.dbPath,
            opportunityId: opportunityId ?? undefined,
            roleId: role.id,
            asOfDate,
            availabilityWindowDays: input.availabilityWindowDays,
            limit: input.resourceSupplyLimit ?? 20,
          }),
        }))
      : [];
  const sharedInput = selectedOpportunityInput({ ...input, opportunityId: extractedOpportunityId, query }, opportunityAssessment);
  const teamBuilder = teamNeeded ? buildTeamOptions(sharedInput) : null;
  const riskInsights = riskNeeded ? buildRiskInsights(sharedInput) : null;
  const approvalDecision = approvalNeeded ? buildApprovalDecision(sharedInput) : null;

  return applyOutputGuardrails({
    route: {
      ...baseRoute,
      executionMode: "tool_orchestrated",
    },
    opportunityAssessment,
    resourceSupply,
    resourceSupplyByRole,
    teamBuilder,
    riskInsights,
    approvalDecision,
    finalResponseType: finalResponseTypeFor(intent),
    message:
      (unsupportedFields.length > 0
        ? unsupportedEvidenceMessage(unsupportedFields, extractedOpportunityId ?? opportunityAssessment?.selectedOpportunityId ?? null)
        : null) ??
      approvalDecision?.recommendationSummary ??
      riskInsights?.summary ??
      teamBuilder?.teamOptions[0]?.summary ??
      (resourceSupply ? `Found ${resourceSupply.summary.totalCandidates} strict candidate(s).` : null) ??
      opportunityAssessment?.selectionReason ??
      "Workforce router completed.",
    evidence: [
      `Router classified the question as ${intent} with ${classified.confidence} confidence.`,
      `Planned tool path: ${toolsToRun.join(" -> ")}.`,
      "Execution mode is tool_orchestrated: deterministic tool functions produced the DB-backed JSON output.",
      intent === "resource_supply"
        ? "Resource Supply was run as a standalone route."
        : "Opportunity Assessment was run before dependent staffing steps.",
      resourceSupplyByRole.length > 0
        ? `Resource Supply was run for ${resourceSupplyByRole.length} assessed role(s).`
        : "No role-wise Resource Supply step was needed for this route.",
      unsupportedFields.length > 0
        ? `Unsupported field request detected: ${unsupportedFields.join(", ")} is not returned by workforce evidence tools.`
        : "No unsupported private or compensation field was requested.",
      approvalDecision
        ? "Approval & Decision produced a human-review package; no approval or booking action was executed."
        : "No approval or booking action was executed.",
    ],
  });
}

export const workforceRouterTool = createTool({
  id: "workforce-router",
  description:
    "Route a workforce planning question to the minimum required tool chain and return the selected JSON output with routing evidence.",
  inputSchema: workforceRouterInputSchema,
  outputSchema: workforceRouterOutputSchema,
  execute: async (input) => routeWorkforceQuestion(input),
});
