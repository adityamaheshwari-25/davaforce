import { availabilitySearch, type AvailabilitySearchInput } from "./availability-search";
import { asNumber, withPlanningDb, all } from "./shared";

const asText = (value: unknown) => String(value ?? "");

export type CapacityCalculatorInput = Omit<AvailabilitySearchInput, "availabilityWindowDays" | "minFte" | "limit"> & {
  referenceDate?: string;
};

export type CapacityWindow = {
  windowDays: number;
  targetDate: string;
  people: number;
  availableFte: number;
  currentBenchPeople: number;
  partialCapacityPeople: number;
  blockedPeople: number;
  releasePlannedPeople: number;
};

export type CapacityCalculatorOutput = {
  source: {
    datasetId: string | null;
    dbPath: string;
    retrievedAtIso: string;
  };
  windows: CapacityWindow[];
  benchMovement: Array<{
    weekStartDate: string;
    currentBenchHeadcount: number;
    emergingBenchHeadcount: number;
    partialCapacityHeadcount: number;
    availableFte: number;
    notes: string;
  }>;
  scenarioTargets: Array<{
    id: string;
    scenarioName: string;
    targetDate: string;
    targetBenchRate: number;
    targetBenchHeadcount: number;
    focus: string;
    successMeasure: string;
    nearestWeekStartDate: string | null;
    currentBenchHeadcount: number | null;
    currentBenchDelta: number | null;
    status: string;
  }>;
  evidence: string[];
};

export function capacityCalculator30_60_90(input: CapacityCalculatorInput): CapacityCalculatorOutput {
  const windowsToEvaluate = [0, 30, 60, 90];
  const perWindow = windowsToEvaluate.map((windowDays) =>
    availabilitySearch({
      ...input,
      availabilityWindowDays: windowDays,
      minFte: 0.01,
      limit: 5000,
    }),
  );

  const benchMovement = withPlanningDb(input, ({ db }) =>
    all<{
      weekStartDate: string;
      currentBenchHeadcount: number | bigint;
      emergingBenchHeadcount: number | bigint;
      partialCapacityHeadcount: number | bigint;
      availableFte: number;
      notes: string | null;
    }>(
      db,
      `
        SELECT weekStartDate,
               currentBenchHeadcount,
               emergingBenchHeadcount,
               partialCapacityHeadcount,
               ROUND(availableFte, 1) AS availableFte,
               notes
        FROM "BenchMovementWeek"
        ORDER BY weekStartDate ASC
      `,
    ).map((row) => ({
      weekStartDate: String(row.weekStartDate),
      currentBenchHeadcount: asNumber(row.currentBenchHeadcount),
      emergingBenchHeadcount: asNumber(row.emergingBenchHeadcount),
      partialCapacityHeadcount: asNumber(row.partialCapacityHeadcount),
      availableFte: asNumber(row.availableFte),
      notes: asText(row.notes),
    })),
  );
  const scenarioTargets = withPlanningDb(input, ({ db }) =>
    all<{
      id: string;
      scenarioName: string;
      targetDate: string;
      targetBenchRate: number;
      targetBenchHeadcount: number | bigint;
      focus: string;
      successMeasure: string;
    }>(
      db,
      `
        SELECT id, scenarioName, targetDate, targetBenchRate, targetBenchHeadcount, focus, successMeasure
        FROM "ScenarioTarget"
        ORDER BY targetDate ASC, scenarioName ASC
      `,
    ).map((row) => {
      const targetDate = asText(row.targetDate);
      const targetBenchHeadcount = asNumber(row.targetBenchHeadcount);
      const nearestWeek = benchMovement.filter((week) => week.weekStartDate <= targetDate).at(-1) ?? benchMovement[0] ?? null;
      const currentBenchDelta =
        nearestWeek == null ? null : Number((nearestWeek.currentBenchHeadcount - targetBenchHeadcount).toFixed(2));
      const status =
        currentBenchDelta == null
          ? "No movement evidence"
          : currentBenchDelta <= 0
            ? "On or below target"
            : "Above target";

      return {
        id: asText(row.id),
        scenarioName: asText(row.scenarioName),
        targetDate,
        targetBenchRate: asNumber(row.targetBenchRate),
        targetBenchHeadcount,
        focus: asText(row.focus),
        successMeasure: asText(row.successMeasure),
        nearestWeekStartDate: nearestWeek?.weekStartDate ?? null,
        currentBenchHeadcount: nearestWeek?.currentBenchHeadcount ?? null,
        currentBenchDelta,
        status,
      };
    }),
  );

  return {
    source: perWindow[0].source,
    windows: perWindow.map((result) => ({
      windowDays: result.filters.availabilityWindowDays,
      targetDate: result.filters.targetDate,
      people: result.summary.totalCandidates,
      availableFte: result.summary.availableInWindowFte,
      currentBenchPeople: result.summary.currentBenchPeople,
      partialCapacityPeople: result.summary.partialCapacityPeople,
      blockedPeople: result.candidates.filter((candidate) => candidate.ewaStatus.toLowerCase().includes("blocked")).length,
      releasePlannedPeople: result.candidates.filter((candidate) => candidate.releaseWindow !== "Current").length,
    })),
    benchMovement,
    scenarioTargets,
    evidence: [
      `Calculated 0, 30, 60, and 90 day capacity windows using tool rules.`,
      `Bench movement trend loaded from ${perWindow[0].source.dbPath}.`,
      `Scenario target status loaded for ${scenarioTargets.length} target(s).`,
    ],
  };
}
