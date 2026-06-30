import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createTool } from "@mastra/core/tools";
import { resolveWorkforceDataSource } from "../../lib/workforce-dataset-store";
import { addUtcDays, asUtcDate, text } from "../../lib/workforce-data-utils";
import {
  resourceSupplyInputSchema,
  resourceSupplyOutputSchema,
  type ResourceSupplyInput,
  type ResourceSupplyOutput,
} from "../schemas/workforce-planning-schemas";

type Row = Record<string, unknown>;
type BenchMovementWeekOutput = ResourceSupplyOutput["benchMovement"][number];
type ScenarioTargetStatusOutput = ResourceSupplyOutput["scenarioTargets"][number];

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
const signalTokens = (value: string) =>
  unique(
    value
      .toLowerCase()
      .split(/[^a-z0-9+#]+/g)
      .filter((token) => token.length >= 3),
  );
const containsSignalOrToken = (haystack: string, signal: string) => {
  const normalizedSignal = signal.toLowerCase();
  if (!normalizedSignal.trim()) return false;
  const haystackTokens = new Set(signalTokens(haystack));
  return containsSignal(haystack, normalizedSignal) || signalTokens(normalizedSignal).some((token) => haystackTokens.has(token));
};

const matches = (candidate: string, expected?: string | null) => {
  const expectedValues = splitList(expected).length > 0 ? splitList(expected) : [text(expected)];
  return (
    !text(expected) ||
    expectedValues.some((value) => text(candidate).toLowerCase().includes(value.toLowerCase()))
  );
};

const isSkillEvidenceLookup = (query: string | undefined, skills: string[]) => {
  if (!skills.length) return false;
  const normalized = text(query).toLowerCase();
  if (!/\b(list|show|give|find|who|which|people|persons|employees?|resources?)\b/.test(normalized)) return false;
  if (!/\b(skill|skills|skilled|knows?|experience|experienced|with)\b/.test(normalized)) return false;
  return !/\b(available|availability|bench|capacity|fte|staff|staffing|assign|team|opportunity|role|roles|within|next\s+\d{1,3}\s+days?)\b/.test(
    normalized,
  );
};

const extractQuerySignals = (db: DatabaseSync, query?: string) => {
  const normalizedQuery = ` ${text(query).toLowerCase()} `;
  const skillRows = all(db, "SELECT name FROM SkillCatalog ORDER BY length(name) DESC").filter((row) =>
    containsSignalOrToken(normalizedQuery, text(row.name)),
  );
  const locationRows = all(
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
  const disciplineRows = all(
    db,
    `
    SELECT DISTINCT discipline
    FROM Person
    ORDER BY discipline
    `,
  ).filter((row) => containsSignal(normalizedQuery, text(row.discipline)));
  const windowMatch = /(?:in|within|next)\s+(\d{1,3})\s*(?:day|days)/i.exec(text(query));

  return {
    skills: unique(skillRows.map((row) => text(row.name))),
    locations: unique(locationRows.map((row) => text(row.location))),
    disciplines: unique(disciplineRows.map((row) => text(row.discipline))),
    availabilityWindowDays: windowMatch ? Number(windowMatch[1]) : null,
  };
};

const roleContext = (db: DatabaseSync, input: ResourceSupplyInput) => {
  if (input.roleId) {
    const role = get(
      db,
      `
      SELECT r.*, o.domain, o.city, o.country, o.region
      FROM "OpportunityRole" r
      JOIN "Opportunity" o ON o.id = r.opportunityId
      WHERE r.id = ?
      `,
      [input.roleId],
    );
    if (role) {
      return {
        opportunityId: text(role.opportunityId),
        roleId: text(role.id),
        roleName: text(role.roleName),
        discipline: text(role.disciplineOrDepartment),
        grade: text(role.gradePreference),
        location: text(role.locationPreference) || text(role.city) || text(role.country) || text(role.region),
        domain: text(role.domainExperienceRequired) || text(role.domain),
        skills: unique(splitList(role.requiredSkillsText).concat(splitList(role.desiredSkillsText))),
        minFte: numberValue(role.minimumIndividualFte) || numberValue(role.fteRequired) || 0.1,
      };
    }
  }

  if (input.opportunityId) {
    const opportunity = get(db, 'SELECT * FROM "Opportunity" WHERE id = ?', [input.opportunityId]);
    const roles = all(db, 'SELECT * FROM "OpportunityRole" WHERE opportunityId = ?', [input.opportunityId]);
    return {
      opportunityId: input.opportunityId,
      roleId: null,
      roleName: unique(roles.map((row) => text(row.roleName))).join("; ") || null,
      discipline: unique(roles.map((row) => text(row.disciplineOrDepartment))).join("; ") || null,
      grade: unique(roles.map((row) => text(row.gradePreference))).join("; ") || null,
      location: unique(
        roles.map((row) => text(row.locationPreference)).concat([text(opportunity?.city), text(opportunity?.country)]),
      ).join("; ") || null,
      domain: text(opportunity?.domain) || null,
      skills: unique(roles.flatMap((row) => splitList(row.requiredSkillsText).concat(splitList(row.desiredSkillsText)))),
      minFte: 0.1,
    };
  }

  return null;
};

const weeklyAvailabilityByPerson = (db: DatabaseSync, targetDate: string) => {
  const rows = all(
    db,
    `
    SELECT personId, ROUND(MAX(availableFte), 2) AS availableFte
    FROM "AvailabilityWeek"
    WHERE weekStartDate <= ?
    GROUP BY personId
    `,
    [targetDate],
  );
  return new Map(rows.map((row) => [text(row.personId), numberValue(row.availableFte)]));
};

const skillsByPerson = (db: DatabaseSync) => {
  const rows = all(
    db,
    `
    SELECT personId, skillName, skillLevel, yearsExperience, confidence
    FROM "PersonSkillEvidence"
    ORDER BY personId, skillLevel DESC, yearsExperience DESC
    `,
  );
  const byPerson = new Map<string, Row[]>();
  for (const row of rows) {
    const personId = text(row.personId);
    const bucket = byPerson.get(personId) ?? [];
    bucket.push(row);
    byPerson.set(personId, bucket);
  }
  return byPerson;
};

const capacityByWindow = (db: DatabaseSync) =>
  all(
    db,
    `
    SELECT releaseWindow AS window,
           COUNT(*) AS people,
           ROUND(SUM(availableFteCurrent), 2) AS fte
    FROM "PersonAvailabilitySnapshot"
    WHERE availableFteCurrent > 0
    GROUP BY releaseWindow
    ORDER BY CASE releaseWindow
      WHEN 'Current' THEN 0
      WHEN '0-30' THEN 1
      WHEN '31-60' THEN 2
      WHEN '61-90' THEN 3
      WHEN 'Partial' THEN 4
      ELSE 5
    END
    `,
  ).map((row) => ({
    window: text(row.window),
    people: numberValue(row.people),
    fte: numberValue(row.fte),
  }));

const benchMovement = (db: DatabaseSync): BenchMovementWeekOutput[] =>
  all(
    db,
    `
    SELECT weekStartDate,
           currentBenchHeadcount,
           emergingBenchHeadcount,
           partialCapacityHeadcount,
           ROUND(availableFte, 2) AS availableFte,
           notes
    FROM "BenchMovementWeek"
    ORDER BY weekStartDate ASC
    `,
  ).map((row) => ({
    weekStartDate: text(row.weekStartDate),
    currentBenchHeadcount: numberValue(row.currentBenchHeadcount),
    emergingBenchHeadcount: numberValue(row.emergingBenchHeadcount),
    partialCapacityHeadcount: numberValue(row.partialCapacityHeadcount),
    availableFte: numberValue(row.availableFte),
    notes: text(row.notes),
  }));

const nearestMovementWeek = (weeks: BenchMovementWeekOutput[], targetDate: string) => {
  const priorOrSameWeek = weeks.filter((week) => week.weekStartDate <= targetDate).at(-1);
  return priorOrSameWeek ?? weeks[0] ?? null;
};

const scenarioTargets = (
  db: DatabaseSync,
  movementWeeks: BenchMovementWeekOutput[],
): ScenarioTargetStatusOutput[] =>
  all(
    db,
    `
    SELECT id,
           scenarioName,
           targetDate,
           targetBenchRate,
           targetBenchHeadcount,
           focus,
           successMeasure
    FROM "ScenarioTarget"
    ORDER BY targetDate ASC, scenarioName ASC
    `,
  ).map((row) => {
    const targetDate = text(row.targetDate);
    const targetBenchHeadcount = numberValue(row.targetBenchHeadcount);
    const nearestWeek = nearestMovementWeek(movementWeeks, targetDate);
    const currentBenchDelta =
      nearestWeek == null ? null : Number((nearestWeek.currentBenchHeadcount - targetBenchHeadcount).toFixed(2));
    const status =
      currentBenchDelta == null
        ? "No movement evidence"
        : currentBenchDelta <= 0
          ? "On or below target"
          : "Above target";

    return {
      id: text(row.id),
      scenarioName: text(row.scenarioName),
      targetDate,
      targetBenchRate: numberValue(row.targetBenchRate),
      targetBenchHeadcount,
      focus: text(row.focus),
      successMeasure: text(row.successMeasure),
      nearestWeekStartDate: nearestWeek?.weekStartDate ?? null,
      currentBenchHeadcount: nearestWeek?.currentBenchHeadcount ?? null,
      currentBenchDelta,
      status,
    };
  });

export function findResourceSupply(input: ResourceSupplyInput): ResourceSupplyOutput {
  const source = resolveWorkforceDataSource({
    datasetId: input.datasetId,
    dbPath: input.dbPath ?? "workforce.db",
  });
  const dbPath = resolve(source.dbPath);
  const db = makeDb(dbPath);
  const retrievedAtIso = new Date().toISOString();

  try {
    const querySignals = extractQuerySignals(db, input.query);
    const context = roleContext(db, input);
    const skills = unique([...(input.skills ?? []), ...(context?.skills ?? []), ...querySignals.skills]);
    const isOpportunityWideSearch = Boolean((context?.opportunityId ?? input.opportunityId) && !(context?.roleId ?? input.roleId));
    const location = input.location ?? querySignals.locations[0] ?? (isOpportunityWideSearch ? null : context?.location) ?? null;
    const domain = input.domain ?? (isOpportunityWideSearch ? null : context?.domain) ?? null;
    const grade = input.grade ?? (isOpportunityWideSearch ? null : context?.grade) ?? null;
    const discipline = input.discipline ?? (isOpportunityWideSearch ? null : context?.discipline) ?? querySignals.disciplines[0] ?? null;
    const todayIso = input.asOfDate ?? new Date().toISOString().slice(0, 10);
    const availabilityWindowDays = input.availabilityWindowDays ?? querySignals.availabilityWindowDays ?? 30;
    const targetDate = addUtcDays(asUtcDate(todayIso), availabilityWindowDays).toISOString().slice(0, 10);
    const contextMinFte = context?.minFte ?? 0.1;
    const skillEvidenceLookup = isSkillEvidenceLookup(input.query, skills);
    const minFte = input.minFte == null
      ? (skillEvidenceLookup ? 0 : contextMinFte)
      : skillEvidenceLookup
        ? input.minFte
        : Math.max(input.minFte, contextMinFte);
    const limit = input.limit ?? 20;
    const weeklyFte = weeklyAvailabilityByPerson(db, targetDate);
    const personSkills = skillsByPerson(db);

    const rows = all(
      db,
      `
      SELECT p.id AS personId, p.name, p.discipline, p.roleArchetype, p.grade, p.city, p.country,
             p.region, p.primaryDomain,
             pas.availabilityCategory, pas.releaseWindow, pas.expectedReleaseDate, pas.availableFteCurrent,
             pas.currentAllocationFte, pas.ewaStatus,
             s.availableFrom, s.supplyFte, s.supplyRisk, s.timeOnSupplyDays, s.suggestedAction, s.targetRoleFit,
             co.rank AS overlayRank, co.overallStaffingScore AS overlayScore, co.fitStatus,
             co.availableFteAtStart, co.fteGap, co.rationale, co."constraint" AS candidateConstraint
      FROM "Person" p
      JOIN "PersonAvailabilitySnapshot" pas ON pas.personId = p.id
      LEFT JOIN "SupplyRecord" s ON s.personId = p.id
      LEFT JOIN (
        SELECT *
        FROM (
          SELECT overlay.*,
                 ROW_NUMBER() OVER (
                   PARTITION BY overlay.personId
                   ORDER BY overlay.overallStaffingScore DESC, overlay.rank ASC
                 ) AS overlayRowNumber
          FROM "OpportunityCandidateOverlay" overlay
          WHERE ? IS NOT NULL
            AND overlay.opportunityId = ?
            AND (? IS NULL OR overlay.opportunityRoleId = ?)
        )
        WHERE overlayRowNumber = 1
      ) co ON co.personId = p.id
      `,
      [context?.opportunityId ?? input.opportunityId ?? null, context?.opportunityId ?? input.opportunityId ?? null, context?.roleId ?? input.roleId ?? null, context?.roleId ?? input.roleId ?? null],
    );

    const scoredCandidates = rows.map((row) => {
      const personId = text(row.personId);
      const availableFteInWindow = Math.max(
        numberValue(row.availableFteCurrent),
        weeklyFte.get(personId) ?? 0,
        numberValue(row.availableFteAtStart),
      );
      const skillRows = personSkills.get(personId) ?? [];
      const matchedSkills = skills.length
        ? skillRows
            .filter((skill) => skills.some((needed) => text(skill.skillName).toLowerCase() === needed.toLowerCase()))
            .map((skill) => text(skill.skillName))
        : skillRows.slice(0, 5).map((skill) => text(skill.skillName));
      const skillMatchCount = skills.length ? matchedSkills.length : 0;
      const skillMatchScore = skills.length ? Math.round((skillMatchCount / skills.length) * 100) : 0;
      const evidence = [
        `Availability ${availableFteInWindow} FTE by ${targetDate}.`,
        matchedSkills.length > 0 ? `Matched skills: ${unique(matchedSkills).join(", ")}.` : "No requested skill match found.",
        row.overlayScore != null ? `Overlay score ${numberValue(row.overlayScore)} rank ${numberValue(row.overlayRank)}.` : "",
        text(row.suggestedAction) ? `Supply action: ${text(row.suggestedAction)}.` : "",
      ].filter(Boolean);

      return {
        personId,
        name: text(row.name),
        discipline: text(row.discipline),
        roleArchetype: text(row.roleArchetype),
        grade: text(row.grade),
        city: text(row.city),
        country: text(row.country),
        primaryDomain: text(row.primaryDomain),
        availabilityCategory: text(row.availabilityCategory),
        releaseWindow: text(row.releaseWindow),
        expectedReleaseDate: text(row.expectedReleaseDate),
        availableFrom: text(row.availableFrom) || null,
        availableFteCurrent: numberValue(row.availableFteCurrent),
        supplyFte: row.supplyFte == null ? null : numberValue(row.supplyFte),
        availableFteInWindow,
        currentAllocationFte: numberValue(row.currentAllocationFte),
        ewaStatus: text(row.ewaStatus),
        benchRisk: row.supplyRisk == null ? null : text(row.supplyRisk),
        timeOnBenchDays: row.timeOnSupplyDays == null ? null : numberValue(row.timeOnSupplyDays),
        matchedSkills: unique(matchedSkills),
        skillMatchCount,
        skillMatchScore,
        overlayScore: row.overlayScore == null ? null : numberValue(row.overlayScore),
        overlayRank: row.overlayRank == null ? null : numberValue(row.overlayRank),
        fitStatus: row.fitStatus == null ? null : text(row.fitStatus),
        fteGap: row.fteGap == null ? null : numberValue(row.fteGap),
        evidence,
        sortScore:
          (row.overlayScore == null ? 0 : numberValue(row.overlayScore)) +
          skillMatchScore +
          availableFteInWindow * 20,
      };
    });

    const passesAvailability = (candidate: (typeof scoredCandidates)[number]) => candidate.availableFteInWindow >= minFte;
    const passesSkillsOrOverlay = (candidate: (typeof scoredCandidates)[number]) =>
      !skills.length || candidate.skillMatchCount > 0 || candidate.overlayScore != null;
    const passesLocation = (candidate: (typeof scoredCandidates)[number]) =>
      matches(candidate.city, location) || matches(candidate.country, location);
    const passesDomain = (candidate: (typeof scoredCandidates)[number]) => matches(candidate.primaryDomain, domain);
    const passesGrade = (candidate: (typeof scoredCandidates)[number]) => matches(candidate.grade, grade);
    const passesDiscipline = (candidate: (typeof scoredCandidates)[number]) => matches(candidate.discipline, discipline);
    const bySortScore = (left: (typeof scoredCandidates)[number], right: (typeof scoredCandidates)[number]) =>
      right.sortScore - left.sortScore;
    const withoutSortScore = ({ sortScore: _sortScore, ...candidate }: (typeof scoredCandidates)[number]) => candidate;

    const afterAvailability = scoredCandidates.filter(passesAvailability);
    const afterSkillsOrOverlay = afterAvailability.filter(passesSkillsOrOverlay);
    const afterLocation = afterSkillsOrOverlay.filter(passesLocation);
    const afterDomain = afterLocation.filter(passesDomain);
    const afterGrade = afterDomain.filter(passesGrade);
    const afterDiscipline = afterGrade.filter(passesDiscipline);

    const filtered = afterDiscipline.sort(bySortScore).slice(0, limit).map(withoutSortScore);

    const missedFilters = (candidate: (typeof scoredCandidates)[number]) =>
      [
        passesAvailability(candidate) ? null : `availability below ${minFte} FTE`,
        passesLocation(candidate) ? null : `location not ${location}`,
        passesDomain(candidate) ? null : `domain not ${domain}`,
        passesGrade(candidate) ? null : `grade not ${grade}`,
        passesDiscipline(candidate) ? null : `discipline not ${discipline}`,
      ].filter((miss): miss is string => Boolean(miss));

    const nearMatches =
      filtered.length > 0
        ? []
        : scoredCandidates
            .filter(passesSkillsOrOverlay)
            .filter((candidate) => candidate.availableFteInWindow > 0 || candidate.overlayScore != null)
            .filter((candidate) => missedFilters(candidate).length > 0)
            .sort(bySortScore)
            .slice(0, Math.min(limit, 5))
            .map((candidate) => {
              const misses = missedFilters(candidate);
              const { sortScore: _sortScore, ...candidateWithoutSortScore } = candidate;
              return {
                ...candidateWithoutSortScore,
                evidence: [
                  ...candidateWithoutSortScore.evidence,
                  `Near match only; missed strict filters: ${misses.join(", ")}.`,
                ],
              };
            });

    const filterDiagnostics = {
      evaluated: scoredCandidates.length,
      afterAvailability: afterAvailability.length,
      afterSkillsOrOverlay: afterSkillsOrOverlay.length,
      afterLocation: afterLocation.length,
      afterDomain: afterDomain.length,
      afterGrade: afterGrade.length,
      afterDiscipline: afterDiscipline.length,
      strictMatches: filtered.length,
    };
    const benchMovementRows = benchMovement(db);
    const scenarioTargetRows = scenarioTargets(db, benchMovementRows);

    const summaryRows = all(
      db,
      `
      SELECT
        SUM(CASE WHEN s.supplyType = 'Current Bench' THEN 1 ELSE 0 END) AS currentBenchPeople,
        SUM(CASE WHEN pas.availabilityCategory = 'Partial Capacity' THEN 1 ELSE 0 END) AS partialCapacityPeople,
        ROUND(SUM(CASE WHEN pas.availableFteCurrent > 0 THEN pas.availableFteCurrent ELSE 0 END), 2) AS availableNowFte
      FROM "PersonAvailabilitySnapshot" pas
      LEFT JOIN "SupplyRecord" s ON s.personId = pas.personId
      `,
    )[0] ?? {};

    const availableInWindowFte = Number(
      filtered.reduce((sum, candidate) => sum + candidate.availableFteInWindow, 0).toFixed(2),
    );
    const risks = [
      filtered.length === 0 && nearMatches.length === 0 ? "No candidates met the current supply filters." : null,
      filtered.length === 0 && nearMatches.length > 0
        ? "No candidates met every strict filter; nearMatches contains candidates after relaxing one or more filters."
        : null,
      skills.length > 0 && filtered.some((candidate) => candidate.skillMatchScore < 100)
        ? "Some candidates only partially match the requested skill set."
        : null,
      filtered.some((candidate) => candidate.ewaStatus.toLowerCase().includes("blocked"))
        ? "At least one candidate has a blocked EWA status."
        : null,
    ].filter((risk): risk is string => risk != null);

    return {
      source: {
        datasetId: source.datasetId,
        dbPath,
        retrievedAtIso,
      },
      filters: {
        opportunityId: context?.opportunityId ?? input.opportunityId ?? null,
        roleId: context?.roleId ?? input.roleId ?? null,
        skills,
        roleName: input.roleName ?? context?.roleName ?? null,
        discipline,
        grade,
        location,
        domain,
        asOfDate: todayIso,
        availabilityWindowDays,
        minFte,
        limit,
      },
      summary: {
        totalCandidates: filtered.length,
        currentBenchPeople: numberValue(summaryRows.currentBenchPeople),
        partialCapacityPeople: numberValue(summaryRows.partialCapacityPeople),
        availableNowFte: numberValue(summaryRows.availableNowFte),
        availableInWindowFte,
      },
      capacityByWindow: capacityByWindow(db),
      benchMovement: benchMovementRows,
      scenarioTargets: scenarioTargetRows,
      candidates: filtered,
      nearMatches,
      filterDiagnostics,
      risks,
      evidence: [
        `Resource supply queried from ${dbPath}.`,
        `Target availability date is ${targetDate} using a ${availabilityWindowDays}-day window from ${todayIso}.`,
        `Returned ${filtered.length} candidate(s) after deterministic filters.`,
        `Loaded ${benchMovementRows.length} bench movement week(s) and ${scenarioTargetRows.length} scenario target(s).`,
        `Filter diagnostics: ${filterDiagnostics.afterDiscipline}/${filterDiagnostics.evaluated} candidate(s) passed all strict filters.`,
      ],
    };
  } finally {
    db.close();
  }
}

export const resourceSupplyTool = createTool({
  id: "resource-supply",
  description:
    "Read the normalized workforce SQLite database and return available candidates, bench capacity, partial capacity, and 30/60/90-day supply evidence.",
  inputSchema: resourceSupplyInputSchema,
  outputSchema: resourceSupplyOutputSchema,
  execute: async (input) => findResourceSupply(input),
});
