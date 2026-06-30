import { text } from "../workforce-data-utils";
import {
  asNumber,
  buildInClause,
  buildTargetDate,
  matchExpected,
  latestAvailabilityByPerson,
  readPlanningQuerySignals,
  resolveRoleContext,
  splitList,
  withPlanningDb,
  all,
} from "./shared";
import type { AgentToolResolvedSource, AgentToolSourceInput } from "./shared";

export type AvailabilitySearchInput = AgentToolSourceInput & {
  query?: string;
  opportunityId?: string;
  roleId?: string;
  candidateIds?: string[];
  discipline?: string;
  grade?: string;
  location?: string;
  domain?: string;
  availabilityWindowDays?: number;
  minFte?: number;
  limit?: number;
  includeBlocked?: boolean;
  referenceDate?: string;
};

export type AvailabilitySearchCandidate = {
  personId: string;
  name: string;
  discipline: string;
  roleArchetype: string;
  grade: string;
  city: string;
  country: string;
  region: string;
  primaryDomain: string;
  availabilityCategory: string;
  releaseWindow: string;
  expectedReleaseDate: string;
  availableFteCurrent: number;
  availableFteInWindow: number;
  availabilityWeekStart: string | null;
  availabilityConfidence: string | null;
  currentAllocationFte: number;
  ewaStatus: string;
  supplyType: string | null;
  supplyRisk: string | null;
  supplyFte: number | null;
  suggestedAction: string | null;
  topSkills: string[];
};

export type AvailabilitySearchOutput = {
  source: AgentToolResolvedSource;
  filters: {
    opportunityId: string | null;
    roleId: string | null;
    discipline: string | null;
    grade: string | null;
    location: string | null;
    domain: string | null;
    availabilityWindowDays: number;
    minFte: number;
    limit: number;
    includeBlocked: boolean;
    targetDate: string;
  };
  summary: {
    totalCandidates: number;
    currentBenchPeople: number;
    partialCapacityPeople: number;
    availableNowFte: number;
    availableInWindowFte: number;
  };
  candidates: AvailabilitySearchCandidate[];
  evidence: string[];
};

export function availabilitySearch(input: AvailabilitySearchInput): AvailabilitySearchOutput {
  return withPlanningDb(input, ({ db, source }) => {
    const querySignals = readPlanningQuerySignals(db, input.query);
    const context = resolveRoleContext(db, input);
    const isOpportunityWideSearch = Boolean((context?.opportunityId ?? input.opportunityId) && !(context?.roleId ?? input.roleId));
    const availabilityWindowDays = input.availabilityWindowDays ?? querySignals.availabilityWindowDays ?? 30;
    const targetDate = buildTargetDate(availabilityWindowDays, input.referenceDate);
    const minFte = input.minFte ?? context?.minFte ?? 0.1;
    const limit = input.limit ?? 50;
    const includeBlocked = input.includeBlocked ?? true;
    const location = input.location ?? querySignals.locations[0] ?? (isOpportunityWideSearch ? null : context?.location) ?? null;
    const discipline = input.discipline ?? (isOpportunityWideSearch ? null : context?.discipline) ?? null;
    const grade = input.grade ?? (isOpportunityWideSearch ? null : context?.grade) ?? null;
    const domain = input.domain ?? (isOpportunityWideSearch ? null : context?.domain) ?? null;
    const candidateClause = buildInClause("p.id", input.candidateIds ?? []);
    const weeklyAvailability = latestAvailabilityByPerson(db, targetDate, input.candidateIds ?? []);

    const rows = all<{
      personId: string;
      name: string;
      discipline: string;
      roleArchetype: string;
      grade: string;
      city: string;
      country: string;
      region: string;
      primaryDomain: string;
      availabilityCategory: string;
      releaseWindow: string;
      expectedReleaseDate: string;
      availableFteCurrent: number;
      currentAllocationFte: number;
      ewaStatus: string;
      supplyType: string | null;
      supplyRisk: string | null;
      supplyFte: number | null;
      suggestedAction: string | null;
      topSkillsText: string | null;
    }>(
      db,
      `
        SELECT
          p.id AS personId,
          p.name,
          p.discipline,
          p.roleArchetype,
          p.grade,
          p.city,
          p.country,
          p.region,
          p.primaryDomain,
          pas.availabilityCategory,
          pas.releaseWindow,
          pas.expectedReleaseDate,
          ROUND(pas.availableFteCurrent, 2) AS availableFteCurrent,
          ROUND(pas.currentAllocationFte, 2) AS currentAllocationFte,
          pas.ewaStatus,
          s.supplyType,
          s.supplyRisk,
          ROUND(s.supplyFte, 2) AS supplyFte,
          s.suggestedAction,
          s.topSkillsText
        FROM "Person" p
        JOIN "PersonAvailabilitySnapshot" pas ON pas.personId = p.id
        LEFT JOIN "SupplyRecord" s ON s.personId = p.id
        WHERE ${candidateClause.sql}
      `,
      candidateClause.params,
    );

    const candidates = rows
      .map((row) => {
        const personId = text(row.personId);
        const weekly = weeklyAvailability.get(personId);
        const futureSupplyFte =
          row.supplyFte != null && text(row.expectedReleaseDate) && text(row.expectedReleaseDate) <= targetDate
            ? asNumber(row.supplyFte)
            : 0;
        const availableFteInWindow = Math.max(asNumber(row.availableFteCurrent), weekly?.availableFte ?? 0, futureSupplyFte);

        return {
          personId,
          name: text(row.name),
          discipline: text(row.discipline),
          roleArchetype: text(row.roleArchetype),
          grade: text(row.grade),
          city: text(row.city),
          country: text(row.country),
          region: text(row.region),
          primaryDomain: text(row.primaryDomain),
          availabilityCategory: text(row.availabilityCategory),
          releaseWindow: text(row.releaseWindow),
          expectedReleaseDate: text(row.expectedReleaseDate),
          availableFteCurrent: asNumber(row.availableFteCurrent),
          availableFteInWindow,
          availabilityWeekStart: weekly?.weekStartDate ?? null,
          availabilityConfidence: weekly?.confidence ?? null,
          currentAllocationFte: asNumber(row.currentAllocationFte),
          ewaStatus: text(row.ewaStatus),
          supplyType: row.supplyType == null ? null : text(row.supplyType),
          supplyRisk: row.supplyRisk == null ? null : text(row.supplyRisk),
          supplyFte: row.supplyFte == null ? null : asNumber(row.supplyFte),
          suggestedAction: row.suggestedAction == null ? null : text(row.suggestedAction),
          topSkills: splitList(row.topSkillsText),
        } satisfies AvailabilitySearchCandidate;
      })
      .filter((candidate) => candidate.availableFteInWindow >= minFte)
      .filter((candidate) => includeBlocked || !candidate.ewaStatus.toLowerCase().includes("blocked"))
      .filter(
        (candidate) =>
          matchExpected(candidate.city, location) ||
          matchExpected(candidate.country, location) ||
          matchExpected(candidate.region, location),
      )
      .filter((candidate) => matchExpected(candidate.discipline, discipline) || matchExpected(candidate.roleArchetype, discipline))
      .filter((candidate) => matchExpected(candidate.grade, grade))
      .filter((candidate) => matchExpected(candidate.primaryDomain, domain))
      .sort((left, right) => {
        if (right.availableFteInWindow !== left.availableFteInWindow) {
          return right.availableFteInWindow - left.availableFteInWindow;
        }
        if (left.expectedReleaseDate !== right.expectedReleaseDate) {
          return left.expectedReleaseDate.localeCompare(right.expectedReleaseDate);
        }
        return left.name.localeCompare(right.name);
      })
      .slice(0, limit);

    return {
      source,
      filters: {
        opportunityId: context?.opportunityId ?? input.opportunityId ?? null,
        roleId: context?.roleId ?? input.roleId ?? null,
        discipline,
        grade,
        location,
        domain,
        availabilityWindowDays,
        minFte,
        limit,
        includeBlocked,
        targetDate,
      },
      summary: {
        totalCandidates: candidates.length,
        currentBenchPeople: candidates.filter((candidate) => candidate.availabilityCategory === "Current Bench").length,
        partialCapacityPeople: candidates.filter((candidate) => candidate.availabilityCategory === "Partial Capacity").length,
        availableNowFte: Number(candidates.reduce((sum, candidate) => sum + candidate.availableFteCurrent, 0).toFixed(2)),
        availableInWindowFte: Number(candidates.reduce((sum, candidate) => sum + candidate.availableFteInWindow, 0).toFixed(2)),
      },
      candidates,
      evidence: [
        `Availability searched in ${source.dbPath}.`,
        `Target date ${targetDate} derived from a ${availabilityWindowDays}-day window.`,
      `Applied tool filters on FTE, location, discipline, grade, and domain.`,
        `Returned ${candidates.length} candidate(s).`,
      ],
    };
  });
}
