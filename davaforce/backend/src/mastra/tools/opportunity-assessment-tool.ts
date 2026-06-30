import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createTool } from "@mastra/core/tools";
import { resolveWorkforceDataSource } from "../../lib/workforce-dataset-store";
import { text } from "../../lib/workforce-data-utils";
import {
  opportunityAssessmentInputSchema,
  opportunityAssessmentOutputSchema,
  type OpportunityAssessmentInput,
  type OpportunityAssessmentOutput,
} from "../schemas/workforce-planning-schemas";

type Row = Record<string, unknown>;

const makeDb = (dbPath: string) => new DatabaseSync(dbPath, { readOnly: true });

const all = (db: DatabaseSync, sql: string, params: any[] = []) =>
  db.prepare(sql).all(...params) as Row[];

const get = (db: DatabaseSync, sql: string, params: any[] = []) =>
  (db.prepare(sql).get(...params) as Row | undefined) ?? null;

const numberValue = (value: unknown) => Number(value ?? 0);

const splitList = (value: unknown) =>
  text(value)
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);

const unique = (values: string[]) => [...new Set(values.map((value) => value.trim()).filter(Boolean))];
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const containsSignal = (haystack: string, signal: string) =>
  new RegExp(`(^|[^a-z0-9+#])${escapeRegExp(signal.toLowerCase())}([^a-z0-9+#]|$)`).test(haystack);

const readRoleSkillRequirements = (
  db: DatabaseSync,
  roleId: string,
  fallbackRequired: unknown,
  fallbackDesired: unknown,
) => {
  const rows = all(
    db,
    `
    SELECT skillName, importance
    FROM "OpportunityRoleSkillRequirement"
    WHERE opportunityRoleId = ?
    ORDER BY CASE importance WHEN 'REQUIRED' THEN 0 ELSE 1 END, skillName ASC
    `,
    [roleId],
  );

  if (rows.length === 0) {
    return {
      requiredSkills: unique(splitList(fallbackRequired)),
      desiredSkills: unique(splitList(fallbackDesired)),
    };
  }

  return {
    requiredSkills: unique(rows.filter((row) => text(row.importance).toLowerCase() === "required").map((row) => text(row.skillName))),
    desiredSkills: unique(rows.filter((row) => text(row.importance).toLowerCase() !== "required").map((row) => text(row.skillName))),
  };
};

const toOpportunity = (row: Row) => ({
  id: text(row.id),
  name: text(row.name),
  clientName: text(row.clientName),
  clientType: text(row.clientType),
  domain: text(row.domain),
  region: text(row.region),
  country: text(row.country),
  city: text(row.city),
  stage: text(row.stage),
  probability: numberValue(row.probability),
  expectedStartDate: text(row.expectedStartDate),
  durationWeeks: numberValue(row.durationWeeks),
  commercialPriority: text(row.commercialPriority),
  deliveryRisk: text(row.deliveryRisk),
  opportunityBrief: text(row.opportunityBrief),
  timezonePreference: text(row.timezonePreference),
});

const toRole = (db: DatabaseSync, row: Row) => {
  const roleSkills = readRoleSkillRequirements(db, text(row.id), row.requiredSkillsText, row.desiredSkillsText);

  return {
    id: text(row.id),
    opportunityId: text(row.opportunityId),
    roleName: text(row.roleName),
    disciplineOrDepartment: text(row.disciplineOrDepartment),
    gradePreference: text(row.gradePreference),
    requiredSkills: roleSkills.requiredSkills,
    desiredSkills: roleSkills.desiredSkills,
    domainExperienceRequired: text(row.domainExperienceRequired),
    locationPreference: text(row.locationPreference),
    startDate: text(row.startDate),
    durationWeeks: numberValue(row.durationWeeks),
    fteRequired: numberValue(row.fteRequired),
    priority: text(row.priority),
    flexibilityNotes: text(row.flexibilityNotes),
    minimumIndividualFte: numberValue(row.minimumIndividualFte),
    canCombineCandidates: Boolean(Number(row.canCombineCandidates ?? 0)),
  };
};

const QUERY_STOP_WORDS = new Set([
  "and",
  "are",
  "available",
  "availability",
  "balanced",
  "bench",
  "best",
  "build",
  "can",
  "capacity",
  "candidate",
  "candidates",
  "closest",
  "compare",
  "cover",
  "coverage",
  "create",
  "current",
  "dates",
  "demand",
  "details",
  "explain",
  "fastest",
  "feasible",
  "filters",
  "fits",
  "for",
  "fte",
  "gaps",
  "has",
  "highest",
  "priority",
  "multiple",
  "need",
  "opportunities",
  "opportunity",
  "options",
  "prioritised",
  "prioritized",
  "probability",
  "required",
  "role",
  "roles",
  "same",
  "should",
  "skill",
  "skills",
  "staffing",
  "staff",
  "start",
  "strongest",
  "team",
  "the",
  "top",
  "urgent",
  "without",
  "what",
  "which",
  "who",
  "with",
]);

const queryTokens = (query?: string) =>
  unique(
    text(query)
      .toLowerCase()
      .split(/[^a-z0-9+#]+/g)
      .filter((token) => token.length >= 3 && !QUERY_STOP_WORDS.has(token)),
  );

const opportunityHaystack = (opportunity: Row) =>
  [
    opportunity.id,
    opportunity.name,
    opportunity.clientName,
    opportunity.clientType,
    opportunity.domain,
    opportunity.region,
    opportunity.country,
    opportunity.city,
    opportunity.stage,
    opportunity.opportunityBrief,
  ]
    .map((value) => text(value).toLowerCase())
    .join(" ");

const toCandidateOpportunity = (opportunity: Row, tokens: string[], selectionReason: string) => {
  const haystack = opportunityHaystack(opportunity);
  const matchedQueryTokens = tokens.filter((token) => haystack.includes(token));

  return {
    id: text(opportunity.id),
    name: text(opportunity.name),
    clientName: text(opportunity.clientName),
    domain: text(opportunity.domain),
    region: text(opportunity.region),
    country: text(opportunity.country),
    stage: text(opportunity.stage),
    probability: numberValue(opportunity.probability),
    expectedStartDate: text(opportunity.expectedStartDate),
    durationWeeks: numberValue(opportunity.durationWeeks),
    commercialPriority: text(opportunity.commercialPriority),
    deliveryRisk: text(opportunity.deliveryRisk),
    matchedQueryTokens,
    queryTokenHits: matchedQueryTokens.length,
    selectionScore: Number((matchedQueryTokens.length + numberValue(opportunity.probability)).toFixed(2)),
    selectionReason,
  };
};

const topProbabilityOpportunityRows = (db: DatabaseSync, limit = 5) =>
  all(
    db,
    `
    SELECT *
    FROM "Opportunity"
    ORDER BY probability DESC,
             CASE commercialPriority WHEN 'High' THEN 0 ELSE 1 END,
             expectedStartDate ASC
    LIMIT ?
    `,
    [limit],
  );

const lowestProbabilityOpportunityRows = (db: DatabaseSync, limit = 5) =>
  all(
    db,
    `
    SELECT *
    FROM "Opportunity"
    ORDER BY probability ASC,
             expectedStartDate ASC,
             name ASC
    LIMIT ?
    `,
    [limit],
  );

const deliveryRiskRankSql = `
  CASE deliveryRisk
    WHEN 'High' THEN 0
    WHEN 'Medium' THEN 1
    WHEN 'Low' THEN 2
    ELSE 3
  END
`;

const topDeliveryRiskOpportunityRows = (db: DatabaseSync, limit = 5) =>
  all(
    db,
    `
    SELECT *
    FROM "Opportunity"
    ORDER BY ${deliveryRiskRankSql},
             probability DESC,
             expectedStartDate ASC
    LIMIT ?
    `,
    [limit],
  );

const priorityRank = (priority: string) => {
  const normalized = priority.toLowerCase();
  if (normalized === "high") return 0;
  if (normalized === "medium") return 1;
  return 2;
};

const prioritizeRoles = (roles: ReturnType<typeof toRole>[]) =>
  [...roles]
    .sort((left, right) => {
      const priorityDelta = priorityRank(left.priority) - priorityRank(right.priority);
      if (priorityDelta !== 0) return priorityDelta;

      const combineDelta = Number(left.canCombineCandidates) - Number(right.canCombineCandidates);
      if (combineDelta !== 0) return combineDelta;

      const fteDelta = right.fteRequired - left.fteRequired;
      if (fteDelta !== 0) return fteDelta;

      return left.startDate.localeCompare(right.startDate) || left.id.localeCompare(right.id);
    })
    .map((role, index) => ({
      priorityOrder: index + 1,
      roleId: role.id,
      roleName: role.roleName,
      fteRequired: role.fteRequired,
      canCombineCandidates: role.canCombineCandidates,
      priority: role.priority,
      reason: [
        `${role.priority || "Unspecified"} priority`,
        `${role.fteRequired} FTE`,
        role.canCombineCandidates ? "splittable" : "single-candidate required",
        `starts ${role.startDate}`,
      ].join("; "),
    }));

const extractQuerySignals = (db: DatabaseSync, query?: string) => {
  const normalizedQuery = ` ${text(query).toLowerCase()} `;
  const skills = all(db, "SELECT name FROM SkillCatalog ORDER BY length(name) DESC").filter((row) =>
    containsSignal(normalizedQuery, text(row.name)),
  );
  const locations = all(
    db,
    `
    SELECT DISTINCT city AS location FROM Person
    UNION
    SELECT DISTINCT country AS location FROM Person
    UNION
    SELECT DISTINCT region AS location FROM Person
    ORDER BY location
    `,
  ).filter((row) => containsSignal(normalizedQuery, text(row.location)));
  const windowMatch = /(?:in|within|next)\s+(\d{1,3})\s*(?:day|days)/i.exec(text(query));
  const roleHints = all(
    db,
    `
    SELECT DISTINCT roleName AS roleHint FROM OpportunityRole
    UNION
    SELECT DISTINCT roleArchetype AS roleHint FROM Person
    UNION
    SELECT DISTINCT discipline AS roleHint FROM Person
    ORDER BY roleHint
    `,
  ).filter((row) => containsSignal(normalizedQuery, text(row.roleHint)));

  return {
    skills: unique(skills.map((row) => text(row.name))),
    locations: unique(locations.map((row) => text(row.location))),
    availabilityWindowDays: windowMatch ? Number(windowMatch[1]) : null,
    roleHints: unique(roleHints.map((row) => text(row.roleHint))),
  };
};

const selectOpportunity = (db: DatabaseSync, input: OpportunityAssessmentInput) => {
  const tokens = queryTokens(input.query);
  const normalizedQuery = text(input.query).toLowerCase();

  if (input.opportunityId) {
    const opportunity = get(db, 'SELECT * FROM "Opportunity" WHERE id = ?', [input.opportunityId]);
    const candidateRows = [
      ...(opportunity ? [opportunity] : []),
      ...topProbabilityOpportunityRows(db, opportunity ? 4 : 5).filter((row) => text(row.id) !== input.opportunityId),
    ].slice(0, 5);

    return {
      opportunity,
      strategy: "explicit-id",
      queryTokens: tokens,
      candidateOpportunities: candidateRows.map((row) =>
        toCandidateOpportunity(
          row,
          tokens,
          text(row.id) === input.opportunityId ? "Selected by explicit opportunityId." : "High-probability reference opportunity.",
        ),
      ),
      reason: opportunity
        ? `Selected explicit opportunityId ${input.opportunityId}.`
        : `No opportunity found for explicit opportunityId ${input.opportunityId}.`,
    };
  }

  if (/\b(delivery risk|highest risk|high risk|riskiest)\b/.test(normalizedQuery)) {
    const candidateRows = topDeliveryRiskOpportunityRows(db);
    const opportunity = candidateRows[0] ?? null;

    return {
      opportunity,
      strategy: "highest-delivery-risk",
      queryTokens: tokens,
      candidateOpportunities: candidateRows.map((row, index) =>
        toCandidateOpportunity(
          row,
          tokens,
          index === 0 ? "Selected as highest delivery-risk opportunity." : "Delivery-risk alternative considered.",
        ),
      ),
      reason: opportunity
        ? "Selected the opportunity with the highest delivery risk, then highest probability."
        : "No opportunities are available in the dataset.",
    };
  }

  if (/\b(lowest probability|lowest probabilty|lowest-probability|lowest-probabilty|least likely|lowest chance|least probable)\b/.test(normalizedQuery)) {
    const candidateRows = lowestProbabilityOpportunityRows(db);
    const opportunity = candidateRows[0] ?? null;

    return {
      opportunity,
      strategy: "lowest-probability",
      queryTokens: tokens,
      candidateOpportunities: candidateRows.map((row, index) =>
        toCandidateOpportunity(
          row,
          tokens,
          index === 0 ? "Selected as lowest-probability opportunity." : "Low-probability alternative considered.",
        ),
      ),
      reason: opportunity
        ? "Selected the opportunity with the lowest probability."
        : "No opportunities are available in the dataset.",
    };
  }

  if (/\b(top opportunity|highest priority opportunity|top demand|current demand)\b/.test(normalizedQuery)) {
    const candidateRows = topProbabilityOpportunityRows(db);
    const opportunity = candidateRows[0] ?? null;

    return {
      opportunity,
      strategy: "highest-priority",
      queryTokens: tokens,
      candidateOpportunities: candidateRows.map((row, index) =>
        toCandidateOpportunity(
          row,
          tokens,
          index === 0 ? "Selected as highest-priority opportunity." : "High-priority alternative considered.",
        ),
      ),
      reason: opportunity
        ? "Selected the highest-priority opportunity using probability, commercial priority, and start date."
        : "No opportunities are available in the dataset.",
    };
  }

  if (tokens.length > 0) {
    const opportunities = all(
      db,
      `
      SELECT *
      FROM "Opportunity"
      ORDER BY probability DESC, commercialPriority DESC, expectedStartDate ASC
      `,
    );
    const scored = opportunities
      .map((opportunity) => {
        const haystack = opportunityHaystack(opportunity);
        const tokenHits = tokens.filter((token) => haystack.includes(token)).length;
        return {
          opportunity,
          score: tokenHits + numberValue(opportunity.probability),
          tokenHits,
        };
      })
      .filter((item) => item.tokenHits > 0)
      .sort((left, right) => right.score - left.score);

    if (scored[0]) {
      return {
        opportunity: scored[0].opportunity,
        strategy: "query-match",
        queryTokens: tokens,
        candidateOpportunities: scored.slice(0, 5).map((item, index) =>
          toCandidateOpportunity(
            item.opportunity,
            tokens,
            index === 0 ? "Selected as strongest query match." : "Alternative query match considered.",
          ),
        ),
        reason: `Selected best opportunity match from query using ${scored[0].tokenHits} matched token(s).`,
      };
    }
  }

  const candidateRows = topProbabilityOpportunityRows(db);
  const opportunity = candidateRows[0] ?? null;

  return {
    opportunity,
    strategy: "highest-probability",
    queryTokens: tokens,
    candidateOpportunities: candidateRows.map((row, index) =>
      toCandidateOpportunity(
        row,
        tokens,
        index === 0 ? "Selected as highest-probability opportunity." : "High-probability alternative considered.",
      ),
    ),
    reason: opportunity
      ? "No explicit opportunity match was supplied, so the highest-probability opportunity was selected for MVP planning."
      : "No opportunities are available in the dataset.",
  };
};

export function assessOpportunity(input: OpportunityAssessmentInput): OpportunityAssessmentOutput {
  const source = resolveWorkforceDataSource({
    datasetId: input.datasetId,
    dbPath: input.dbPath ?? "workforce.db",
  });
  const dbPath = resolve(source.dbPath);
  const db = makeDb(dbPath);
  const retrievedAtIso = new Date().toISOString();
  const asOfDate = input.asOfDate ?? retrievedAtIso.slice(0, 10);

  try {
    const selected = selectOpportunity(db, input);
    const opportunity = selected.opportunity ? toOpportunity(selected.opportunity) : null;
    const roles = opportunity
      ? all(
          db,
          `
          SELECT *
          FROM "OpportunityRole"
          WHERE opportunityId = ?
          ORDER BY CASE priority WHEN 'High' THEN 0 ELSE 1 END, startDate ASC, id ASC
          `,
          [opportunity.id],
        ).map((row) => toRole(db, row))
      : [];
    const querySignals = extractQuerySignals(db, input.query);

    const requiredSkills = unique(roles.flatMap((role) => role.requiredSkills));
    const desiredSkills = unique(roles.flatMap((role) => role.desiredSkills));
    const missingFields = [
      opportunity ? null : "opportunity",
      roles.length > 0 ? null : "required roles",
      requiredSkills.length > 0 ? null : "required skills",
      opportunity?.expectedStartDate ? null : "start date",
    ].filter((field): field is string => field != null);

    return {
      source: {
        datasetId: source.datasetId,
        dbPath,
        retrievedAtIso,
      },
      asOfDate,
      selectedOpportunityId: opportunity?.id ?? null,
      selectionReason: selected.reason,
      selectionDiagnostics: {
        strategy: selected.strategy,
        queryTokens: selected.queryTokens,
        candidateOpportunities: selected.candidateOpportunities,
      },
      opportunity,
      roles,
      rolePrioritization: prioritizeRoles(roles),
      normalizedRequirements: {
        requiredRoles: unique(roles.map((role) => role.roleName)),
        requiredSkills,
        desiredSkills,
        grades: unique(roles.map((role) => role.gradePreference)),
        locations: unique(roles.map((role) => role.locationPreference || opportunity?.city || "").concat(querySignals.locations)),
        domain: opportunity?.domain ?? null,
        startDate: opportunity?.expectedStartDate ?? null,
        durationWeeks: opportunity?.durationWeeks ?? null,
        totalFteRequired: Number(roles.reduce((sum, role) => sum + role.fteRequired, 0).toFixed(2)),
      },
      extractedQuerySignals: querySignals,
      missingFields,
      evidence: [
        `Opportunity table queried from ${dbPath}.`,
        `Assessment as-of date is ${asOfDate}.`,
        opportunity
          ? `Selected ${opportunity.id} with ${roles.length} role(s) and ${opportunity.probability} probability.`
          : "No matching opportunity row was found.",
        `Query signals: ${querySignals.skills.length} skill(s), ${querySignals.locations.length} location(s), ${querySignals.roleHints.length} role hint(s).`,
        "Confirmed requirements come from selected opportunity roles; query signals are kept separate in extractedQuerySignals.",
        "Role skills were read from OpportunityRoleSkillRequirement with text-field fallback.",
      ],
    };
  } finally {
    db.close();
  }
}

export const opportunityAssessmentTool = createTool({
  id: "opportunity-assessment",
  description:
    "Read the normalized workforce SQLite database and return structured opportunity requirements for staffing planning.",
  inputSchema: opportunityAssessmentInputSchema,
  outputSchema: opportunityAssessmentOutputSchema,
  execute: async (input) => assessOpportunity(input),
});
