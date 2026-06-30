import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { resolveWorkforceDataSource } from "../../lib/workforce-dataset-store";
import { text } from "../../lib/workforce-data-utils";
import { normalizeSchemaValidationState } from "../../lib/workforce-schema-validation-types";

type Row = Record<string, unknown>;
type QueryParam = string | number | null;

const genericDatasetQueryInputSchema = z.object({
  datasetId: z.string().optional(),
  dbPath: z.string().optional(),
  query: z.string(),
  limit: z.number().int().positive().max(100).default(25),
});

const genericDatasetQueryOutputSchema = z.object({
  source: z.object({
    datasetId: z.string().nullable(),
    dbPath: z.string(),
    retrievedAtIso: z.string(),
  }),
  query: z.string(),
  queryType: z.enum(["list", "count", "group_count"]),
  tableName: z.string(),
  tableDisplayName: z.string(),
  confidence: z.string(),
  generatedSql: z.string(),
  parameters: z.array(z.union([z.string(), z.number(), z.null()])),
  selectedColumns: z.array(z.object({ columnName: z.string(), displayName: z.string() })),
  filters: z.array(z.object({ term: z.string(), columns: z.array(z.string()) })),
  groupBy: z.object({ columnName: z.string(), displayName: z.string() }).nullable(),
  totalMatchingRows: z.number(),
  returnedRows: z.number(),
  headers: z.array(z.string()),
  rows: z.array(z.array(z.string())),
  evidence: z.array(z.string()),
});

export type GenericDatasetQueryInput = z.input<typeof genericDatasetQueryInputSchema>;
export type GenericDatasetQueryOutput = z.infer<typeof genericDatasetQueryOutputSchema>;

type TableColumn = {
  columnName: string;
  displayName: string;
  type: string;
};

type TableMetadata = {
  tableName: string;
  tableDisplayName: string;
  columns: TableColumn[];
  rowCount: number;
  synonyms: string[];
};

type QueryColumn = {
  columnName: string;
  displayName: string;
  sql: string;
  type: string;
};

const SYSTEM_TABLES = new Set(["DatasetSchemaHeader", "ImportBatch", "RawSheetRow", "sqlite_sequence"]);

const TABLE_SYNONYMS: Record<string, string[]> = {
  Person: ["people", "person", "employees", "employee", "resources", "resource", "consultants", "consultant"],
  PersonAvailabilitySnapshot: ["availability snapshot", "availability", "available", "allocation status"],
  Profile: ["profiles", "profile", "summary", "strengths", "certifications", "languages"],
  SkillCatalog: ["skill catalog", "skills catalog", "catalog", "skill definitions", "skill categories"],
  PersonSkillEvidence: ["skills", "skill", "skill evidence", "experience", "years experience"],
  CurrentAllocation: ["allocations", "allocation", "current allocation", "project", "projects", "client"],
  SupplyRecord: ["supply", "bench", "current bench", "future roll-off", "roll off", "rolloff"],
  PartialCapacityView: ["partial capacity", "capacity", "partial"],
  AvailabilityWeek: ["availability calendar", "calendar", "weekly availability", "availability week"],
  BenchMovementWeek: ["bench movement", "movement", "trend", "weekly trend"],
  ProjectHistory: ["project history", "history", "past projects", "domain history"],
  Opportunity: ["opportunities", "opportunity", "pipeline", "demand", "client demand"],
  OpportunityRole: ["opportunity roles", "roles", "role", "required roles", "demand roles"],
  OpportunityRoleSkillRequirement: ["role skills", "required skills", "desired skills", "skill requirements"],
  OpportunityCandidateOverlay: ["overlays", "candidate overlays", "candidate fit", "staffing score", "fit score"],
  EwaRequest: ["ewa", "ewa requests", "approval", "approvals", "booking"],
  ScenarioTarget: ["scenario", "scenarios", "targets", "scenario targets"],
};

const PREFERRED_COLUMNS: Record<string, string[]> = {
  Person: ["id", "name", "discipline", "grade", "city", "country", "primaryDomain", "workMode"],
  PersonAvailabilitySnapshot: ["personId", "availabilityCategory", "availableFteCurrent", "expectedReleaseDate", "releaseWindow", "ewaStatus"],
  Profile: ["personId", "profileSummary", "keyStrengthsText", "preferredWorkTypes", "certificationsText"],
  PersonSkillEvidence: ["personId", "skillName", "skillLevel", "yearsExperience", "confidence", "lastUsedDate"],
  SkillCatalog: ["name", "category", "description", "relevantDepartmentsText"],
  Opportunity: ["id", "name", "clientName", "domain", "stage", "probability", "commercialPriority", "deliveryRisk"],
  OpportunityRole: ["id", "opportunityId", "roleName", "disciplineOrDepartment", "gradePreference", "fteRequired", "priority"],
  OpportunityRoleSkillRequirement: ["opportunityRoleId", "skillName", "importance"],
  OpportunityCandidateOverlay: ["opportunityId", "opportunityRoleId", "personId", "fitStatus", "rank", "matchScore", "ewaStatus"],
  CurrentAllocation: ["personId", "clientName", "projectName", "domain", "roleOnProject", "allocationFte", "plannedEndDate"],
  SupplyRecord: ["personId", "availableFrom", "supplyFte", "supplyRisk", "timeOnSupplyDays", "suggestedAction"],
  PartialCapacityView: ["personId", "availableFrom", "benchFte", "benchRisk", "timeOnBenchDays", "suggestedAction"],
  AvailabilityWeek: ["personId", "weekStartDate", "availableFte", "availabilityType", "ewaStatus", "confidence"],
  ProjectHistory: ["personId", "clientName", "projectName", "domain", "role", "startDate", "endDate"],
  EwaRequest: ["id", "opportunityId", "opportunityRoleId", "personId", "requestedFte", "ewaStatus", "blockingReason"],
  ScenarioTarget: ["id", "scenarioName", "targetDate", "targetBenchRate", "targetBenchHeadcount", "focus", "successMeasure"],
};

const STOP_WORDS = new Set([
  "a",
  "all",
  "also",
  "an",
  "and",
  "any",
  "are",
  "as",
  "based",
  "be",
  "both",
  "by",
  "can",
  "count",
  "data",
  "dataset",
  "display",
  "do",
  "does",
  "employee",
  "employees",
  "experience",
  "experienced",
  "for",
  "from",
  "get",
  "give",
  "group",
  "has",
  "have",
  "how",
  "in",
  "is",
  "know",
  "knows",
  "list",
  "many",
  "me",
  "number",
  "of",
  "on",
  "per",
  "people",
  "person",
  "persons",
  "please",
  "record",
  "records",
  "resource",
  "resources",
  "row",
  "rows",
  "show",
  "skill",
  "skilled",
  "skills",
  "table",
  "tables",
  "tell",
  "that",
  "the",
  "there",
  "to",
  "total",
  "what",
  "where",
  "which",
  "who",
  "with",
]);

const quoteIdentifier = (value: string) => `"${value.replace(/"/g, '""')}"`;

const makeDb = (dbPath: string) => new DatabaseSync(dbPath, { readOnly: true });

const all = (db: DatabaseSync, sql: string, params: QueryParam[] = []) => db.prepare(sql).all(...params) as Row[];

const get = (db: DatabaseSync, sql: string, params: QueryParam[] = []) =>
  (db.prepare(sql).get(...params) as Row | undefined) ?? null;

const asNumber = (value: unknown) => {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  return Number(value ?? 0) || 0;
};

const cellText = (value: unknown) => {
  if (value == null) return "";
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return `[${value.byteLength} bytes]`;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

const normalize = (value: unknown) =>
  text(value)
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9+#. ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokens = (value: unknown) =>
  normalize(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 || /\d/.test(token));

const unique = (values: string[]) => [...new Set(values.map((value) => text(value)).filter(Boolean))];

const containsWord = (haystack: string, needle: string) => {
  const normalizedNeedle = normalize(needle);
  if (!normalizedNeedle) return false;
  return ` ${haystack} `.includes(` ${normalizedNeedle} `);
};

const isSkillLookupToken = (token: string) =>
  token.length >= 3 || /[+#.]/.test(token);

const aliasMapForSource = (dataset: ReturnType<typeof resolveWorkforceDataSource>["dataset"]) => {
  const aliases = new Map<string, Map<string, string>>();
  const validation = normalizeSchemaValidationState(dataset?.schemaValidation);
  for (const table of validation?.tables ?? []) {
    aliases.set(
      table.tableName,
      new Map(table.columns.map((column) => [column.columnName, column.displayName])),
    );
  }
  return aliases;
};

const readTables = (db: DatabaseSync, aliases: Map<string, Map<string, string>>): TableMetadata[] =>
  (
    all(db, `
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `) as Array<{ name: string }>
  )
    .map((row) => text(row.name))
    .filter((tableName) => tableName && !SYSTEM_TABLES.has(tableName))
    .map((tableName) => {
      const tableAliases = aliases.get(tableName) ?? new Map<string, string>();
      const columns = (all(db, `PRAGMA table_info(${quoteIdentifier(tableName)})`) as Array<{ name: string; type: string }>).map(
        (column) => {
          const columnName = text(column.name);
          return {
            columnName,
            displayName: tableAliases.get(columnName) ?? columnName,
            type: text(column.type) || "ANY",
          };
        },
      );
      const rowCount = asNumber(get(db, `SELECT COUNT(*) AS rowCount FROM ${quoteIdentifier(tableName)}`)?.rowCount);
      return {
        tableName,
        tableDisplayName: tableName,
        columns,
        rowCount,
        synonyms: TABLE_SYNONYMS[tableName] ?? [],
      };
    });

const tableIntentBoost = (tableName: string, query: string) => {
  const normalizedQuery = normalize(query);
  const has = (pattern: RegExp) => pattern.test(normalizedQuery);

  if (tableName === "SupplyRecord" && has(/\b(bench|supply|roll off|rolloff|available|availability|supply risk)\b/)) return 28;
  if (tableName === "PartialCapacityView" && has(/\b(partial capacity|partial|bench percent|bench fte)\b/)) return 30;
  if (tableName === "AvailabilityWeek" && has(/\b(availability calendar|weekly availability|week|weeks|available fte|availability type)\b/)) return 26;
  if (tableName === "PersonAvailabilitySnapshot" && has(/\b(availability snapshot|release window|expected release|current allocation fte|available fte current)\b/)) return 24;
  if (tableName === "CurrentAllocation" && has(/\b(allocation|allocations|current project|current role|planned end|client|project)\b/)) return 24;
  if (tableName === "ProjectHistory" && has(/\b(project history|history|past project|past projects|technologies|methods|outcome)\b/)) return 28;
  if (tableName === "Opportunity" && has(/\b(opportunity|opportunities|pipeline|stage|commercial priority|delivery risk|probability)\b/)) return 26;
  if (tableName === "OpportunityRole" && has(/\b(opportunity role|opportunity roles|roles|role demand|fte required|grade preference)\b/)) return 36;
  if (tableName === "OpportunityRoleSkillRequirement" && has(/\b(required skill|desired skill|skill requirement|role skill)\b/)) return 34;
  if (tableName === "OpportunityCandidateOverlay" && has(/\b(overlay|candidate|candidates|fit status|fit score|match score|staffing score|rank)\b/)) return 28;
  if (tableName === "EwaRequest" && has(/\b(ewa|approval|booking|blocker|blocking|pending approval|next action)\b/)) return 30;
  if (tableName === "ScenarioTarget" && has(/\b(scenario|target bench|bench target|success measure|target date)\b/)) return 26;
  if (tableName === "Profile" && has(/\b(profile|profiles|certification|certifications|languages|strengths|mobility)\b/)) return 24;

  return 0;
};

const tableScore = (db: DatabaseSync, table: TableMetadata, query: string) => {
  const normalizedQuery = normalize(query);
  let score = tableIntentBoost(table.tableName, query);
  const tableSignals = [table.tableName, table.tableDisplayName, ...table.synonyms].flatMap(tokens);
  for (const signal of unique(tableSignals)) {
    if (containsWord(normalizedQuery, signal)) score += 8;
  }

  for (const column of table.columns) {
    const columnSignals = [column.columnName, column.displayName].flatMap(tokens);
    for (const signal of unique(columnSignals)) {
      if (containsWord(normalizedQuery, signal)) score += 3;
    }
  }

  const queryTokens = querySearchTokens(query, table, null, { includeValues: true });
  if (queryTokens.length) {
    const sampleRows = all(db, `SELECT * FROM ${quoteIdentifier(table.tableName)} LIMIT 50`);
    for (const term of queryTokens) {
      if (
        sampleRows.some((row) =>
          table.columns.some((column) => normalize(row[column.columnName]).includes(normalize(term))),
        )
      ) {
        score += 4;
      }
    }
  }

  return score;
};

const chooseTable = (db: DatabaseSync, tables: TableMetadata[], query: string) => {
  const ranked = tables
    .map((table) => ({ table, score: tableScore(db, table, query) }))
    .sort((left, right) => right.score - left.score || right.table.rowCount - left.table.rowCount);
  return ranked[0] ?? null;
};

const queryType = (query: string): GenericDatasetQueryOutput["queryType"] => {
  if (/\b(count|how many|number of|total)\b/i.test(query)) {
    return /\b(by|per|grouped by|breakdown by)\b/i.test(query) ? "group_count" : "count";
  }
  if (/\b(by|per|grouped by|breakdown by)\b/i.test(query)) {
    return "group_count";
  }
  return "list";
};

const columnMatchScore = (column: TableColumn, query: string) => {
  const normalizedQuery = normalize(query);
  return unique([column.columnName, column.displayName].flatMap(tokens)).reduce(
    (score, token) => score + (containsWord(normalizedQuery, token) ? 1 : 0),
    0,
  );
};

const baseQueryColumns = (table: TableMetadata): QueryColumn[] =>
  table.columns.map((column) => ({
    columnName: column.columnName,
    displayName: column.displayName,
    sql: `b.${quoteIdentifier(column.columnName)}`,
    type: column.type,
  }));

const chooseGroupColumn = (table: TableMetadata, query: string, extraColumns: QueryColumn[] = []) => {
  const afterBy = /\b(?:by|per|grouped by|breakdown by)\s+([a-z0-9_+#.\s-]{2,40})/i.exec(query)?.[1] ?? "";
  const scopedQuery = afterBy || query;
  const ranked = [...baseQueryColumns(table), ...extraColumns]
    .map((column) => ({ column, score: columnMatchScore(column, scopedQuery) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score);
  return ranked[0]?.column ?? null;
};

const defaultColumns = (table: TableMetadata) => {
  const preferred = PREFERRED_COLUMNS[table.tableName] ?? [];
  const preferredColumns = preferred
    .map((columnName) => table.columns.find((column) => column.columnName === columnName))
    .filter((column): column is TableColumn => Boolean(column));
  const fallback = table.columns.filter((column) => !preferredColumns.includes(column));
  return [...preferredColumns, ...fallback].slice(0, 8);
};

const selectedColumns = (table: TableMetadata, query: string, type: GenericDatasetQueryOutput["queryType"]) => {
  if (type !== "list") {
    return [];
  }

  const mentioned = table.columns
    .map((column) => ({ column, score: columnMatchScore(column, query) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .map((item) => item.column);

  if (mentioned.length) {
    const natural = defaultColumns(table).slice(0, 2);
    return unique([...natural, ...mentioned].map((column) => column.columnName))
      .map((columnName) => table.columns.find((column) => column.columnName === columnName))
      .filter((column): column is TableColumn => Boolean(column))
      .slice(0, 8);
  }

  return defaultColumns(table);
};

function querySearchTokens(
  query: string,
  table: TableMetadata,
  groupBy: Pick<TableColumn, "columnName" | "displayName"> | null,
  options: { includeValues?: boolean; extraExclusions?: string[] } = {},
) {
  const excluded = new Set<string>([...STOP_WORDS]);
  for (const signal of [table.tableName, table.tableDisplayName, ...table.synonyms]) {
    for (const token of tokens(signal)) excluded.add(token);
  }
  for (const column of table.columns) {
    for (const token of tokens(column.columnName)) excluded.add(token);
    for (const token of tokens(column.displayName)) excluded.add(token);
  }
  if (groupBy) {
    for (const token of tokens(groupBy.columnName)) excluded.add(token);
    for (const token of tokens(groupBy.displayName)) excluded.add(token);
  }
  for (const value of options.extraExclusions ?? []) {
    for (const token of tokens(value)) excluded.add(token);
  }

  const quotedPhrases = Array.from(query.matchAll(/"([^"]+)"/g)).map((match) => text(match[1]));
  const rawTokens = tokens(query).filter((token) => !excluded.has(token));
  const values = unique([...quotedPhrases, ...rawTokens]);
  return options.includeValues ? values : values.filter((value) => value.length >= 2 || /\d/.test(value));
}

const whereClauseForColumns = (columns: QueryColumn[], terms: string[]) => {
  const params: QueryParam[] = [];
  const clauses = terms.map((term) => {
    const columnClauses = columns.map((column) => `CAST(${column.sql} AS TEXT) LIKE ? COLLATE NOCASE`);
    params.push(...columns.map(() => `%${term}%`));
    return `(${columnClauses.join(" OR ")})`;
  });

  return {
    sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    params,
    columns: columns.map((column) => column.displayName),
  };
};

const relationColumn = (alias: string, columnName: string, displayName: string): QueryColumn => ({
  columnName: `${alias}_${columnName}`,
  displayName,
  sql: `${alias}.${quoteIdentifier(columnName)}`,
  type: "TEXT",
});

const PERSON_SEARCH_COLUMNS = [
  relationColumn("p", "id", "Person ID"),
  relationColumn("p", "name", "Person"),
  relationColumn("p", "region", "Person Region"),
  relationColumn("p", "country", "Person Country"),
  relationColumn("p", "city", "Person City"),
  relationColumn("p", "department", "Person Department"),
  relationColumn("p", "discipline", "Person Discipline"),
  relationColumn("p", "grade", "Person Grade"),
  relationColumn("p", "primaryDomain", "Person Primary Domain"),
  relationColumn("p", "secondaryDomain", "Person Secondary Domain"),
  relationColumn("p", "workMode", "Person Work Mode"),
];

const PERSON_DISPLAY_COLUMNS = [
  relationColumn("p", "name", "Person"),
  relationColumn("p", "city", "City"),
  relationColumn("p", "discipline", "Discipline"),
];

const OPPORTUNITY_SEARCH_COLUMNS = [
  relationColumn("o", "name", "Opportunity"),
  relationColumn("o", "id", "Opportunity ID"),
  relationColumn("o", "clientName", "Opportunity Client"),
  relationColumn("o", "clientType", "Opportunity Client Type"),
  relationColumn("o", "region", "Opportunity Region"),
  relationColumn("o", "country", "Opportunity Country"),
  relationColumn("o", "city", "Opportunity City"),
  relationColumn("o", "domain", "Opportunity Domain"),
  relationColumn("o", "stage", "Opportunity Stage"),
  relationColumn("o", "commercialPriority", "Opportunity Priority"),
  relationColumn("o", "deliveryRisk", "Opportunity Delivery Risk"),
];

const OPPORTUNITY_DISPLAY_COLUMNS = [
  relationColumn("o", "name", "Opportunity"),
  relationColumn("o", "clientName", "Client"),
  relationColumn("o", "stage", "Stage"),
];

const ROLE_SEARCH_COLUMNS = [
  relationColumn("r", "id", "Role ID"),
  relationColumn("r", "roleName", "Role"),
  relationColumn("r", "disciplineOrDepartment", "Role Discipline"),
  relationColumn("r", "gradePreference", "Role Grade"),
  relationColumn("r", "requiredSkillsText", "Required Skills"),
  relationColumn("r", "desiredSkillsText", "Desired Skills"),
  relationColumn("r", "domainExperienceRequired", "Role Domain Experience"),
  relationColumn("r", "locationPreference", "Role Location"),
  relationColumn("r", "priority", "Role Priority"),
];

const ROLE_DISPLAY_COLUMNS = [
  relationColumn("r", "roleName", "Role"),
  relationColumn("r", "priority", "Role Priority"),
];

const SUPPLY_SEARCH_COLUMNS = [
  relationColumn("s", "supplyType", "Supply Type"),
  relationColumn("s", "availabilityCategory", "Supply Category"),
  relationColumn("s", "primaryDomain", "Supply Domain"),
  relationColumn("s", "topSkillsText", "Supply Skills"),
  relationColumn("s", "supplyRisk", "Supply Risk"),
  relationColumn("s", "suggestedAction", "Supply Action"),
  relationColumn("s", "targetRoleFit", "Supply Role Fit"),
  relationColumn("s", "recordUsage", "Supply Record Usage"),
];

const relationExclusions = (columns: QueryColumn[], signals: string[]) => [
  ...signals,
  ...columns.flatMap((column) => [column.columnName, column.displayName]),
];

const hasColumn = (table: TableMetadata, columnName: string) =>
  table.columns.some((column) => column.columnName === columnName);

const queryContextForTable = (table: TableMetadata) => {
  const joins: string[] = [];
  const searchColumns = baseQueryColumns(table).filter((column) => !/blob/i.test(column.type));
  const displayColumns: QueryColumn[] = [];
  const groupColumns: QueryColumn[] = [];
  const extraExclusions: string[] = [];
  const addJoin = (sql: string) => {
    if (!joins.includes(sql)) joins.push(sql);
  };
  const addColumns = (columns: QueryColumn[], display: QueryColumn[], signals: string[]) => {
    searchColumns.push(...columns);
    displayColumns.push(...display);
    groupColumns.push(...columns);
    extraExclusions.push(...relationExclusions(columns, signals));
  };

  if (table.tableName !== "Person" && hasColumn(table, "personId")) {
    addJoin(`LEFT JOIN "Person" p ON p.id = b.${quoteIdentifier("personId")}`);
    addColumns(PERSON_SEARCH_COLUMNS, PERSON_DISPLAY_COLUMNS, TABLE_SYNONYMS.Person ?? []);
  }

  if (table.tableName === "PartialCapacityView" && hasColumn(table, "sourceBenchRecordId")) {
    addJoin(`LEFT JOIN "SupplyRecord" s ON s.id = b.${quoteIdentifier("sourceBenchRecordId")}`);
    addColumns(SUPPLY_SEARCH_COLUMNS, [relationColumn("s", "supplyType", "Supply Type")], TABLE_SYNONYMS.SupplyRecord ?? []);
  }

  if (table.tableName === "OpportunityRoleSkillRequirement" && hasColumn(table, "opportunityRoleId")) {
    addJoin(`LEFT JOIN "OpportunityRole" r ON r.id = b.${quoteIdentifier("opportunityRoleId")}`);
    addJoin(`LEFT JOIN "Opportunity" o ON o.id = r.${quoteIdentifier("opportunityId")}`);
    addColumns(ROLE_SEARCH_COLUMNS, ROLE_DISPLAY_COLUMNS, TABLE_SYNONYMS.OpportunityRole ?? []);
    addColumns(OPPORTUNITY_SEARCH_COLUMNS, OPPORTUNITY_DISPLAY_COLUMNS, TABLE_SYNONYMS.Opportunity ?? []);
  } else {
    if (table.tableName !== "OpportunityRole" && hasColumn(table, "opportunityRoleId")) {
      addJoin(`LEFT JOIN "OpportunityRole" r ON r.id = b.${quoteIdentifier("opportunityRoleId")}`);
      addColumns(ROLE_SEARCH_COLUMNS, ROLE_DISPLAY_COLUMNS, TABLE_SYNONYMS.OpportunityRole ?? []);
    }
    if (table.tableName !== "Opportunity" && hasColumn(table, "opportunityId")) {
      addJoin(`LEFT JOIN "Opportunity" o ON o.id = b.${quoteIdentifier("opportunityId")}`);
      addColumns(OPPORTUNITY_SEARCH_COLUMNS, OPPORTUNITY_DISPLAY_COLUMNS, TABLE_SYNONYMS.Opportunity ?? []);
    }
    if (table.tableName === "OpportunityRole" && hasColumn(table, "opportunityId")) {
      addJoin(`LEFT JOIN "Opportunity" o ON o.id = b.${quoteIdentifier("opportunityId")}`);
      addColumns(OPPORTUNITY_SEARCH_COLUMNS, OPPORTUNITY_DISPLAY_COLUMNS, TABLE_SYNONYMS.Opportunity ?? []);
    }
  }

  return {
    fromSql: `${quoteIdentifier(table.tableName)} b${joins.length ? ` ${joins.join(" ")}` : ""}`,
    searchColumns,
    displayColumns,
    groupColumns,
    extraExclusions,
  };
};

const derivedValueTerms = (tableName: string, query: string) => {
  const normalizedQuery = normalize(query);
  const terms: string[] = [];

  if (tableName === "SupplyRecord") {
    const futureRollOff = /\bfuture roll ?off\b/.test(normalizedQuery);
    const partialCapacity = /\bpartial capacity\b/.test(normalizedQuery);
    const currentBench =
      /\bcurrent bench\b/.test(normalizedQuery) ||
      (!futureRollOff && !partialCapacity && /\b(on bench|bench people|bench resources|people .*bench|resources .*bench)\b/.test(normalizedQuery));
    if (currentBench) terms.push("Current Bench");
    if (futureRollOff) terms.push("Future Roll-off");
    if (partialCapacity) terms.push("Partial Capacity");
  }
  if (tableName === "EwaRequest" || tableName === "OpportunityCandidateOverlay") {
    if (/\bpending approval\b/.test(normalizedQuery)) terms.push("Pending Approval");
    if (/\bblocked\b/.test(normalizedQuery)) terms.push("Blocked");
    if (/\bapproved\b/.test(normalizedQuery)) terms.push("Approved");
  }
  if (tableName === "Opportunity") {
    if (/\bhigh priority\b/.test(normalizedQuery)) terms.push("High");
    if (/\bmedium priority\b/.test(normalizedQuery)) terms.push("Medium");
    if (/\blow priority\b/.test(normalizedQuery)) terms.push("Low");
  }

  return terms;
};

const uniqueQueryColumns = (columns: QueryColumn[]) => {
  const seen = new Set<string>();
  return columns.filter((column) => {
    const key = `${column.displayName}::${column.sql}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const PERSON_SKILL_PERSON_FILTER_COLUMNS = [
  { sql: "p.name", label: "Person" },
  { sql: "p.region", label: "Region" },
  { sql: "p.country", label: "Country" },
  { sql: "p.city", label: "City" },
  { sql: "p.department", label: "Department" },
  { sql: "p.discipline", label: "Discipline" },
  { sql: "p.grade", label: "Grade" },
  { sql: "p.primaryDomain", label: "Primary Domain" },
  { sql: "p.secondaryDomain", label: "Secondary Domain" },
  { sql: "p.workMode", label: "Work Mode" },
];

const personSkillValueTerms = (query: string, skills: string[]) => {
  const excluded = new Set(STOP_WORDS);
  for (const skill of skills) {
    for (const token of tokens(skill)) {
      excluded.add(token);
      if (token.startsWith(".")) excluded.add(token.slice(1));
    }
  }
  return unique(tokens(query).filter((token) => !excluded.has(token)));
};

const personSkillPersonWhere = (terms: string[]) => {
  const params: QueryParam[] = [];
  const sql = terms
    .map((term) => {
      params.push(...PERSON_SKILL_PERSON_FILTER_COLUMNS.map(() => `%${term}%`));
      return `(${PERSON_SKILL_PERSON_FILTER_COLUMNS
        .map((column) => `CAST(${column.sql} AS TEXT) LIKE ? COLLATE NOCASE`)
        .join(" OR ")})`;
    })
    .join(" AND ");

  return {
    sql,
    params,
    columns: PERSON_SKILL_PERSON_FILTER_COLUMNS.map((column) => column.label),
  };
};

const runPeopleSkillLookup = (
  db: DatabaseSync,
  source: GenericDatasetQueryOutput["source"],
  query: string,
  limit: number,
): GenericDatasetQueryOutput | null => {
  const normalizedQuery = normalize(query);
  const hasPeopleEntity = /\b(people|persons|employees|resources|person|employee)\b/.test(normalizedQuery);
  const hasSkillIntent = /\b(skill|skills|skilled|experience|experienced|knows?)\b/.test(normalizedQuery);
  const hasPeopleWithValue = hasPeopleEntity && /\bwith\b/.test(normalizedQuery);
  const type = queryType(query);
  const skills = (all(db, `SELECT name FROM "SkillCatalog" ORDER BY length(name) DESC`) as Array<{ name: string }>)
    .map((row) => text(row.name))
    .filter((skillName) => tokens(skillName).some((token) => isSkillLookupToken(token) && containsWord(normalizedQuery, token)));
  if (!skills.length) return null;
  if (!hasSkillIntent && !hasPeopleWithValue && !hasPeopleEntity) return null;

  const placeholders = skills.map(() => "?").join(", ");
  const personTerms = personSkillValueTerms(query, skills);
  const personWhere = personSkillPersonWhere(personTerms);
  const personFilterSql = personWhere.sql ? `AND ${personWhere.sql}` : "";
  const uniquePeopleCount = asNumber(
    get(
      db,
      `
      SELECT COUNT(DISTINCT pse.personId) AS rowCount
      FROM "PersonSkillEvidence" pse
      JOIN "Person" p ON p.id = pse.personId
      WHERE pse.skillName IN (${placeholders})
      ${personFilterSql}
      `,
      [...skills, ...personWhere.params],
    )?.rowCount,
  );
  const filters = [
    { term: skills.join(", "), columns: ["Skill"] },
    ...personTerms.map((term) => ({ term, columns: personWhere.columns })),
  ];

  if (type === "count") {
    return {
      source,
      query,
      queryType: "count",
      tableName: "PersonSkillEvidence",
      tableDisplayName: "Person Skill Evidence",
      confidence: "High",
      generatedSql: `
        SELECT COUNT(DISTINCT pse.personId) AS rowCount
        FROM "PersonSkillEvidence" pse
        JOIN "Person" p ON p.id = pse.personId
        WHERE pse.skillName IN (${placeholders})
        ${personFilterSql}
      `.trim().replace(/\s+/g, " "),
      parameters: [...skills, ...personWhere.params],
      selectedColumns: [{ columnName: "people", displayName: "People" }],
      filters,
      groupBy: null,
      totalMatchingRows: uniquePeopleCount,
      returnedRows: 1,
      headers: ["People"],
      rows: [[cellText(uniquePeopleCount)]],
      evidence: [
        "Generic DB Query Tool selected a read-only person-to-skill count.",
        `Matched requested skill(s): ${skills.join(", ")}.`,
        "Executed a parameterized COUNT DISTINCT over PersonSkillEvidence.",
      ],
    };
  }

  const rows = all(
    db,
    `
    SELECT p.name AS personName,
           p.discipline,
           p.grade,
           p.city,
           p.country,
           pse.skillName,
           pse.skillLevel,
           pse.yearsExperience,
           pse.confidence
    FROM "PersonSkillEvidence" pse
    JOIN "Person" p ON p.id = pse.personId
    WHERE pse.skillName IN (${placeholders})
    ${personFilterSql}
    ORDER BY pse.skillLevel DESC, pse.yearsExperience DESC, p.name ASC
    LIMIT ?
    `,
    [...skills, ...personWhere.params, limit],
  );
  const count = asNumber(
    get(
      db,
      `
      SELECT COUNT(*) AS rowCount
      FROM "PersonSkillEvidence" pse
      JOIN "Person" p ON p.id = pse.personId
      WHERE pse.skillName IN (${placeholders})
      ${personFilterSql}
      `,
      [...skills, ...personWhere.params],
    )?.rowCount,
  );
  const headers = ["Person", "Discipline", "Grade", "City", "Country", "Skill", "Level", "Years", "Confidence"];

  return {
    source,
    query,
    queryType: "list",
    tableName: "PersonSkillEvidence",
    tableDisplayName: "Person Skill Evidence",
    confidence: "High",
    generatedSql: `
      SELECT p.name, p.discipline, p.grade, p.city, p.country, pse.skillName, pse.skillLevel, pse.yearsExperience, pse.confidence
      FROM "PersonSkillEvidence" pse
      JOIN "Person" p ON p.id = pse.personId
      WHERE pse.skillName IN (${placeholders})
      ${personFilterSql}
      LIMIT ?
    `.trim().replace(/\s+/g, " "),
    parameters: [...skills, ...personWhere.params, limit],
    selectedColumns: headers.map((header) => ({ columnName: header, displayName: header })),
    filters,
    groupBy: null,
    totalMatchingRows: count,
    returnedRows: rows.length,
    headers,
    rows: rows.map((row) => [
      cellText(row.personName),
      cellText(row.discipline),
      cellText(row.grade),
      cellText(row.city),
      cellText(row.country),
      cellText(row.skillName),
      cellText(row.skillLevel),
      cellText(row.yearsExperience),
      cellText(row.confidence),
    ]),
    evidence: [
      "Generic DB Query Tool selected a read-only person-to-skill lookup.",
      `Matched requested skill(s): ${skills.join(", ")}.`,
      "Executed a parameterized SELECT over PersonSkillEvidence joined to Person.",
    ],
  };
};

export const queryGenericDataset = (input: GenericDatasetQueryInput): GenericDatasetQueryOutput => {
  const resolved = resolveWorkforceDataSource({
    datasetId: input.datasetId,
    dbPath: input.dbPath ?? "workforce.db",
  });
  const dbPath = resolve(resolved.dbPath);
  const db = makeDb(dbPath);
  const source = {
    datasetId: resolved.datasetId,
    dbPath,
    retrievedAtIso: new Date().toISOString(),
  };
  const limit = Math.max(1, Math.min(Math.trunc(input.limit ?? 25), 100));
  const query = text(input.query);

  try {
    const peopleSkillLookup = runPeopleSkillLookup(db, source, query, limit);
    if (peopleSkillLookup) {
      return peopleSkillLookup;
    }

    const aliases = aliasMapForSource(resolved.dataset);
    const tables = readTables(db, aliases);
    const selected = chooseTable(db, tables, query);
    if (!selected) {
      throw new Error("No queryable dataset tables were found.");
    }

    const type = queryType(query);
    const context = queryContextForTable(selected.table);
    const groupBy = type === "group_count" ? chooseGroupColumn(selected.table, query, context.groupColumns) : null;
    const derivedTerms = derivedValueTerms(selected.table.tableName, query);
    const derivedTokens = new Set(derivedTerms.flatMap(tokens));
    const searchTerms = unique([
      ...derivedTerms,
      ...querySearchTokens(query, selected.table, groupBy, { extraExclusions: context.extraExclusions }).filter(
        (term) => !derivedTokens.has(term),
      ),
    ]);
    const where = whereClauseForColumns(context.searchColumns, searchTerms);
    const confidence = selected.score >= 12 ? "High" : selected.score >= 5 ? "Medium" : "Low";
    const relationEvidence = context.displayColumns.length
      ? "Joined related workforce tables so filters can match connected people, opportunities, and roles."
      : "No related-table join was needed for this lookup.";

    if (type === "count" && !groupBy) {
      const sql = `SELECT COUNT(*) AS count FROM ${context.fromSql} ${where.sql}`.trim();
      const count = asNumber(get(db, sql, where.params)?.count);
      return {
        source,
        query,
        queryType: "count",
        tableName: selected.table.tableName,
        tableDisplayName: selected.table.tableDisplayName,
        confidence,
        generatedSql: sql,
        parameters: where.params,
        selectedColumns: [{ columnName: "count", displayName: "Count" }],
        filters: searchTerms.map((term) => ({ term, columns: where.columns })),
        groupBy: null,
        totalMatchingRows: count,
        returnedRows: 1,
        headers: ["Count"],
        rows: [[cellText(count)]],
        evidence: [
          `Generic DB Query Tool selected table ${selected.table.tableName}.`,
          relationEvidence,
          "Executed a read-only COUNT query with parameterized filters.",
        ],
      };
    }

    if (type === "group_count" && groupBy) {
      const sql = `
        SELECT ${groupBy.sql} AS groupValue, COUNT(*) AS count
        FROM ${context.fromSql}
        ${where.sql}
        GROUP BY ${groupBy.sql}
        ORDER BY count DESC, groupValue ASC
        LIMIT ?
      `;
      const rows = all(db, sql, [...where.params, limit]);
      const total = asNumber(get(db, `SELECT COUNT(*) AS rowCount FROM ${context.fromSql} ${where.sql}`, where.params)?.rowCount);
      return {
        source,
        query,
        queryType: "group_count",
        tableName: selected.table.tableName,
        tableDisplayName: selected.table.tableDisplayName,
        confidence,
        generatedSql: sql.trim().replace(/\s+/g, " "),
        parameters: [...where.params, limit],
        selectedColumns: [
          { columnName: groupBy.columnName, displayName: groupBy.displayName },
          { columnName: "count", displayName: "Count" },
        ],
        filters: searchTerms.map((term) => ({ term, columns: where.columns })),
        groupBy: { columnName: groupBy.columnName, displayName: groupBy.displayName },
        totalMatchingRows: total,
        returnedRows: rows.length,
        headers: [groupBy.displayName, "Count"],
        rows: rows.map((row) => [cellText(row.groupValue), cellText(row.count)]),
        evidence: [
          `Generic DB Query Tool selected table ${selected.table.tableName}.`,
          relationEvidence,
          `Grouped results by ${groupBy.displayName}.`,
          "Executed a read-only grouped SELECT with parameterized filters.",
        ],
      };
    }

    const columns = uniqueQueryColumns([
      ...context.displayColumns,
      ...selectedColumns(selected.table, query, "list").map((column) => ({
        columnName: column.columnName,
        displayName: column.displayName,
        sql: `b.${quoteIdentifier(column.columnName)}`,
        type: column.type,
      })),
    ]).slice(0, 10);
    const aliasedColumns = columns.map((column, index) => ({ ...column, rowKey: `col_${index}` }));
    const columnSql = aliasedColumns
      .map((column) => `${column.sql} AS ${quoteIdentifier(column.rowKey)}`)
      .join(", ");
    const countSql = `SELECT COUNT(*) AS rowCount FROM ${context.fromSql} ${where.sql}`.trim();
    const rowSql = `SELECT ${columnSql} FROM ${context.fromSql} ${where.sql} LIMIT ?`.trim();
    const totalMatchingRows = asNumber(get(db, countSql, where.params)?.rowCount);
    const rows = all(db, rowSql, [...where.params, limit]);

    return {
      source,
      query,
      queryType: "list",
      tableName: selected.table.tableName,
      tableDisplayName: selected.table.tableDisplayName,
      confidence,
      generatedSql: rowSql,
      parameters: [...where.params, limit],
      selectedColumns: aliasedColumns.map((column) => ({ columnName: column.columnName, displayName: column.displayName })),
      filters: searchTerms.map((term) => ({ term, columns: where.columns })),
      groupBy: null,
      totalMatchingRows,
      returnedRows: rows.length,
      headers: aliasedColumns.map((column) => column.displayName),
      rows: rows.map((row) => aliasedColumns.map((column) => cellText(row[column.rowKey]))),
      evidence: [
        `Generic DB Query Tool selected table ${selected.table.tableName}.`,
        relationEvidence,
        searchTerms.length
          ? `Applied filter term(s): ${searchTerms.join(", ")}.`
          : "No value filters were needed for this lookup.",
        "Executed a read-only SELECT query with a row limit.",
      ],
    };
  } finally {
    db.close();
  }
};

export const genericDatasetQueryTool = createTool({
  id: "generic-dataset-query",
  description: "Answer generic table questions with safe read-only SELECT queries over the uploaded workforce dataset.",
  inputSchema: genericDatasetQueryInputSchema,
  outputSchema: genericDatasetQueryOutputSchema,
  execute: async (input) => queryGenericDataset(input),
});
