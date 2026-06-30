import type { D1DatabaseLike, D1Value, R2BucketLike } from "./runtime";
import {
  readWorkbookSheetsFromBuffer,
  type CellValue,
  type WorkbookRow,
  type WorkbookSheets,
} from "../lib/workbook-xlsx-buffer";
import type { WorkforceUploadProgressUpdate } from "../lib/workforce-upload-progress";
import { WORKFORCE_UPLOAD_STEP_LABELS } from "../lib/workforce-upload-progress";
import {
  WORKFORCE_SCHEMA_VALIDATION_VERSION,
  SchemaValidationAlreadyCompletedError,
  normalizeSchemaValidationState,
  pendingSchemaValidationState,
  sanitizeSchemaDisplayName,
  schemaValidationSummary,
  type WorkforceSchemaValidationState,
  type WorkforceSchemaValidationSummary,
  type WorkforceSchemaValidationTableAlias,
} from "../lib/workforce-schema-validation-types";

const DUMMY_USER_ROLES = [
  "Workforce Planner",
  "Delivery Manager",
  "Sales / Client Partner",
  "Regional Leader",
] as const;

export type DummyUserRole = (typeof DUMMY_USER_ROLES)[number];

export type DummyUserPublicRecord = {
  userId: string;
  username: string;
  role: DummyUserRole;
  profileImage: string;
};

export type CloudDatasetRecord = {
  datasetId: string;
  ownerUserId: string;
  label: string | null;
  dbFileName: string;
  excelFileName: string;
  originalFileName: string;
  workbookVersion: string | null;
  createdAt: string;
  importCounts: Record<string, number>;
  conversationId: string | null;
  sourceSha256: string;
  excelObjectKey: string;
  staticDashboard: WorkforceStaticDashboardSnapshot | null;
  schemaValidation: WorkforceSchemaValidationState | null;
};

export type CloudDatasetClientRecord = {
  datasetId: string;
  ownerUserId: string;
  label: string | null;
  dbFileName: string;
  originalFileName: string;
  workbookVersion: string | null;
  createdAt: string;
  importCounts: Record<string, number>;
  conversationId: string | null;
  schemaValidation: WorkforceSchemaValidationSummary;
};

export type WorkforceDashboardSection = "summary" | "supply" | "demand" | "staffingFit" | "skills" | "ewa";

export type WorkforceDashboardBundle = {
  summary: Record<string, unknown>;
  supply: Record<string, unknown>;
  demand: Record<string, unknown>;
  staffingFit: Record<string, unknown>;
  skills: {
    requiredSkillDemand: Array<Record<string, unknown>>;
    skillSupply: Array<Record<string, unknown>>;
    skillGaps: Array<{ skillName: string; requiredRoles: number; people: number; gap: number }>;
  };
  ewa: Record<string, unknown>;
};

export type WorkforceStaticDashboardSnapshot = {
  schemaVersion: 1;
  generatedAt: string;
  source: {
    datasetId: string;
    sourceSha256: string;
    originalFileName: string;
    sourceName: string;
    workbookVersion: string | null;
    createdAt: string;
    importedAt: string;
  };
  history: Array<{
    generatedAt: string;
    trigger: "upload" | "backfill";
    sourceSha256: string;
    importedAt: string;
  }>;
  sections: WorkforceDashboardBundle;
};

export type WorkforceConversationRole = "user" | "assistant";

export type WorkforceConversationMessage = {
  id: string;
  conversationId: string;
  role: WorkforceConversationRole;
  content: string;
  detailView: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
};

export type WorkforceConversationSummary = {
  id: string;
  userId: string;
  datasetId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  activeOpportunityId: string | null;
  activeOpportunityName: string | null;
  lastDetailView: string | null;
  lastSummary: string | null;
  messageCount: number;
  lastMessage: string | null;
};

export type WorkforceConversation = WorkforceConversationSummary & {
  messages: WorkforceConversationMessage[];
};

const REQUIRED_CANONICAL_SHEETS = [
  "People",
  "Skills",
  "Skill Catalog",
  "Profiles",
  "Allocations",
  "Bench",
  "Partial Capacity",
  "Availability Calendar",
  "Bench Movement",
  "Project History",
  "Opportunities",
  "Opportunity Roles",
  "Opportunity Overlays",
  "EWA Requests",
  "Scenario Targets",
];

const NATURAL_KEY_COLUMNS: Record<string, string> = {
  README: "Item",
  "Dataset Summary": "Metric",
  "Data Dictionary": "Column",
  People: "Employee_ID",
  Skills: "Skill_Row_ID",
  "Skill Catalog": "SkillName",
  Profiles: "Profile_ID",
  Allocations: "Allocation_ID",
  Bench: "Bench_Record_ID",
  "Partial Capacity": "Bench_Record_ID",
  "Availability Calendar": "Availability_ID",
  "Bench Movement": "WeekStartDate",
  "Project History": "History_ID",
  Opportunities: "Opportunity_ID",
  "Opportunity Roles": "Opportunity_Role_ID",
  "Opportunity Overlays": "Overlay_ID",
  "EWA Requests": "EWA_Request_ID",
  "Scenario Targets": "Scenario_ID",
};

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS "DummyUser" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL UNIQUE,
    "password" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "profile_image" TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "WorkforceDataset" (
    "datasetId" TEXT NOT NULL PRIMARY KEY,
    "ownerUserId" TEXT NOT NULL,
    "label" TEXT,
    "dbFileName" TEXT NOT NULL,
    "excelFileName" TEXT NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "workbookVersion" TEXT,
    "createdAt" TEXT NOT NULL,
    "importCountsJson" TEXT NOT NULL,
    "conversationId" TEXT,
    "sourceSha256" TEXT NOT NULL,
    "excelObjectKey" TEXT NOT NULL,
    "staticDashboardJson" TEXT,
    "schemaValidationJson" TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS "WorkforceDataset_owner_created_idx"
    ON "WorkforceDataset"("ownerUserId", "createdAt" DESC)`,
  `CREATE TABLE IF NOT EXISTS "WorkforceRawSheetRow" (
    "datasetId" TEXT NOT NULL,
    "sheetName" TEXT NOT NULL,
    "sourceRowNumber" INTEGER NOT NULL,
    "naturalKey" TEXT,
    "rowHash" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    PRIMARY KEY ("datasetId", "sheetName", "sourceRowNumber")
  )`,
  `CREATE INDEX IF NOT EXISTS "WorkforceRawSheetRow_sheet_idx"
    ON "WorkforceRawSheetRow"("datasetId", "sheetName", "sourceRowNumber")`,
  `CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    dataset_id TEXT NOT NULL,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    active_opportunity_id TEXT,
    active_opportunity_name TEXT,
    last_detail_view TEXT,
    last_summary TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS conversation_messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    detail_view TEXT,
    details_json TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS conversations_user_dataset_idx
    ON conversations(user_id, dataset_id, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS conversation_messages_conversation_idx
    ON conversation_messages(conversation_id, created_at ASC)`,
];

const schemaMigrationStatements = [
  `ALTER TABLE "WorkforceDataset" ADD COLUMN "schemaValidationJson" TEXT`,
];

let schemaReady = false;

const encoder = new TextEncoder();

const text = (value: unknown): string => {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
};

const optionalText = (value: unknown): string | null => text(value) || null;
const asNumber = (value: unknown) => Number(value ?? 0) || 0;
const asInt = (value: unknown) => Math.trunc(asNumber(value));
const asFloat = (value: unknown) => asNumber(value);

const asBool = (value: unknown) => {
  if (typeof value === "boolean") return value;
  const cleaned = text(value).toLowerCase();
  return cleaned === "yes" || cleaned === "true" || cleaned === "1";
};

const parseSemicolonList = (value: unknown) =>
  text(value)
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);

const utcNowIsoWithOffset = () => new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00");

const d1Run = (db: D1DatabaseLike, sql: string, params: D1Value[] = []) => db.prepare(sql).bind(...params).run();

const d1All = async <T extends Record<string, unknown>>(
  db: D1DatabaseLike,
  sql: string,
  params: D1Value[] = [],
) => {
  const result = await db.prepare(sql).bind(...params).all<T>();
  return result.results ?? [];
};

const d1First = <T extends Record<string, unknown>>(
  db: D1DatabaseLike,
  sql: string,
  params: D1Value[] = [],
) => db.prepare(sql).bind(...params).first<T>();

const d1Many = async (db: D1DatabaseLike, sql: string, rows: D1Value[][]) => {
  const chunkSize = 50;
  for (let index = 0; index < rows.length; index += chunkSize) {
    const chunk = rows.slice(index, index + chunkSize);
    if (db.batch) {
      await db.batch(chunk.map((row) => db.prepare(sql).bind(...row)));
    } else {
      for (const row of chunk) {
        await d1Run(db, sql, row);
      }
    }
  }
};

const avatarSvgBase64 = (initials: string, accent: string) =>
  btoa(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" rx="28" fill="#192b37"/><circle cx="66" cy="28" r="18" fill="${accent}" opacity=".9"/><circle cx="34" cy="64" r="24" fill="#ffffff" opacity=".08"/><text x="48" y="57" text-anchor="middle" font-family="Dava Sans, Arial, sans-serif" font-size="30" font-weight="700" fill="#ffffff">${initials}</text></svg>`,
  );

const SEEDED_USERS = [
  {
    userId: "user_sarah_001",
    username: "sarah",
    password: "sarah123",
    role: "Workforce Planner",
    profileImage: avatarSvgBase64("SA", "#ff5640"),
  },
  {
    userId: "user_jenny_001",
    username: "jenny",
    password: "jenny123",
    role: "Sales / Client Partner",
    profileImage: avatarSvgBase64("JE", "#5899c4"),
  },
  {
    userId: "user_raj_001",
    username: "raj",
    password: "raj123",
    role: "Delivery Manager",
    profileImage: avatarSvgBase64("RA", "#2fa66a"),
  },
  {
    userId: "user_david_001",
    username: "david",
    password: "david123",
    role: "Regional Leader",
    profileImage: avatarSvgBase64("DA", "#f59e0b"),
  },
] as const;

const isDummyUserRole = (value: string | null | undefined): value is DummyUserRole =>
  DUMMY_USER_ROLES.some((role) => role === value);

const normalizeRole = (value: string | null | undefined): DummyUserRole =>
  isDummyUserRole(value) ? value : "Workforce Planner";

const toPublicUser = (row: Record<string, unknown> | null): DummyUserPublicRecord | null =>
  row
    ? {
        userId: text(row.userId),
        username: text(row.username),
        role: normalizeRole(text(row.role)),
        profileImage: text(row.profileImage),
      }
    : null;

export const ensureCloudSchema = async (db: D1DatabaseLike) => {
  if (schemaReady) return;
  for (const statement of schemaStatements) {
    await d1Run(db, statement);
  }
  for (const statement of schemaMigrationStatements) {
    try {
      await d1Run(db, statement);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/duplicate column|already exists/i.test(message)) {
        throw error;
      }
    }
  }
  for (const user of SEEDED_USERS) {
    await d1Run(
      db,
      `
      INSERT INTO "DummyUser" ("userId", "username", "password", "role", "profile_image")
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT("userId") DO UPDATE SET
        "username" = excluded."username",
        "password" = excluded."password",
        "role" = excluded."role",
        "profile_image" = excluded."profile_image"
      `,
      [user.userId, user.username, user.password, user.role, user.profileImage],
    );
  }
  schemaReady = true;
};

export const loginCloudDummyUser = async (db: D1DatabaseLike, username: string, password: string) => {
  await ensureCloudSchema(db);
  const row = await d1First(
    db,
    `
    SELECT "userId", "username", "password", "role", "profile_image" AS "profileImage"
    FROM "DummyUser"
    WHERE "username" = ? AND "password" = ?
    LIMIT 1
    `,
    [text(username), text(password)],
  );
  return toPublicUser(row);
};

export const getCloudDummyUserById = async (db: D1DatabaseLike, userId: string) => {
  await ensureCloudSchema(db);
  const row = await d1First(
    db,
    `
    SELECT "userId", "username", "password", "role", "profile_image" AS "profileImage"
    FROM "DummyUser"
    WHERE "userId" = ?
    LIMIT 1
    `,
    [text(userId)],
  );
  return toPublicUser(row);
};

export const updateCloudDummyUserRole = async (db: D1DatabaseLike, input: { userId: string; role: string }) => {
  await ensureCloudSchema(db);
  const userId = text(input.userId);
  const role = text(input.role);
  if (!isDummyUserRole(role)) {
    throw new Error(`Invalid role: ${role}`);
  }
  const user = await getCloudDummyUserById(db, userId);
  if (!user) {
    throw new Error(`User not found: ${userId}`);
  }
  await d1Run(db, `UPDATE "DummyUser" SET "role" = ? WHERE "userId" = ?`, [role, userId]);
  return { ...user, role };
};

const safeJsonParse = <T>(value: unknown, fallback: T): T => {
  if (typeof value !== "string" || !value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const toDatasetRecord = (row: Record<string, unknown>): CloudDatasetRecord => ({
  datasetId: text(row.datasetId),
  ownerUserId: text(row.ownerUserId),
  label: optionalText(row.label),
  dbFileName: text(row.dbFileName),
  excelFileName: text(row.excelFileName),
  originalFileName: text(row.originalFileName),
  workbookVersion: optionalText(row.workbookVersion),
  createdAt: text(row.createdAt),
  importCounts: safeJsonParse<Record<string, number>>(row.importCountsJson, {}),
  conversationId: optionalText(row.conversationId),
  sourceSha256: text(row.sourceSha256),
  excelObjectKey: text(row.excelObjectKey),
  staticDashboard: safeJsonParse<WorkforceStaticDashboardSnapshot | null>(row.staticDashboardJson, null),
  schemaValidation: normalizeSchemaValidationState(
    safeJsonParse<unknown>(row.schemaValidationJson, null),
  ),
});

export const toClientDatasetRecord = (record: CloudDatasetRecord): CloudDatasetClientRecord => ({
  datasetId: record.datasetId,
  ownerUserId: record.ownerUserId,
  label: record.label,
  dbFileName: record.dbFileName,
  originalFileName: record.originalFileName,
  workbookVersion: record.workbookVersion,
  createdAt: record.createdAt,
  importCounts: record.importCounts,
  conversationId: record.conversationId,
  schemaValidation: schemaValidationSummary(record.schemaValidation),
});

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

const createDatasetId = (originalFileName: string) => {
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const stem = slugify(originalFileName.replace(/\.[^.]+$/, "")) || "workbook";
  return `wf_${timestamp}_${stem}_${crypto.randomUUID().slice(0, 8)}`;
};

const createConversationId = () => `conv_${crypto.randomUUID()}`;
const createMessageId = () => `msg_${crypto.randomUUID()}`;

const hashBytes = async (bytes: Uint8Array) => {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const fnvHash = (value: string) => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const jsonScalar = (value: unknown): string => {
  if (value == null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value) : "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString().slice(0, 10));
  if (Array.isArray(value)) return `[${value.map(jsonScalar).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${jsonScalar(item)}`)
      .join(",")}}`;
  }
  return "null";
};

const normalizeCellValue = (value: CellValue): string | number | boolean | null => {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value ?? null;
};

const rowPayloadJson = (row: WorkbookRow) => {
  const normalized: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(row)) {
    normalized[key] = normalizeCellValue(value);
  }
  return jsonScalar(normalized);
};

const ensureRequiredSheets = (sheets: WorkbookSheets) => {
  const missing = REQUIRED_CANONICAL_SHEETS.filter((sheetName) => !(sheetName in sheets));
  if (missing.length > 0) {
    throw new Error(`Workbook is missing required sheets: ${missing.join(", ")}`);
  }
};

const workbookVersion = (sheets: WorkbookSheets) => {
  const readme = sheets.README;
  if (!readme) return null;
  const metadata = Object.fromEntries(readme.rows.map((row) => [text(row.values.Item), text(row.values.Details)]));
  return metadata.Version || null;
};

const sheetValues = (sheets: WorkbookSheets, sheetName: string) => sheets[sheetName]?.rows.map((row) => row.values) ?? [];

const sortText = (left: unknown, right: unknown) => text(left).localeCompare(text(right));
const priorityRank = (value: unknown) => ({ High: 0, Medium: 1, Low: 2 }[text(value) as "High" | "Medium" | "Low"] ?? 3);
const riskRank = (value: unknown) => ({ High: 0, Medium: 1, Low: 2 }[text(value) as "High" | "Medium" | "Low"] ?? 3);
const stageRank = (value: unknown) =>
  ({ Discovery: 0, Qualified: 1, Proposal: 2, Shortlisted: 3, Committed: 4 }[
    text(value) as "Discovery" | "Qualified" | "Proposal" | "Shortlisted" | "Committed"
  ] ?? 5);

const average = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0);
const round = (value: number, decimals = 1) => Number(value.toFixed(decimals));

const group = <T,>(rows: T[], key: (row: T) => string) => {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const groupKey = key(row);
    map.set(groupKey, [...(map.get(groupKey) ?? []), row]);
  }
  return map;
};

const distinct = (values: string[]) => [...new Set(values.filter(Boolean))];

const makeLookup = (rows: WorkbookRow[], key: keyof WorkbookRow | string) => {
  const lookup = new Map<string, WorkbookRow>();
  for (const row of rows) {
    lookup.set(text(row[key]), row);
  }
  return lookup;
};

const buildDashboardSections = (
  sheets: WorkbookSheets,
  record: Pick<CloudDatasetRecord, "datasetId" | "originalFileName" | "createdAt" | "workbookVersion" | "sourceSha256">,
  importedAt: string,
): WorkforceDashboardBundle => {
  const people = sheetValues(sheets, "People");
  const skills = sheetValues(sheets, "Skills");
  const skillCatalog = sheetValues(sheets, "Skill Catalog");
  const bench = sheetValues(sheets, "Bench");
  const benchMovement = sheetValues(sheets, "Bench Movement");
  const opportunities = sheetValues(sheets, "Opportunities");
  const roles = sheetValues(sheets, "Opportunity Roles");
  const overlays = sheetValues(sheets, "Opportunity Overlays");
  const ewaRequests = sheetValues(sheets, "EWA Requests");
  const peopleById = makeLookup(people, "Employee_ID");
  const opportunityById = makeLookup(opportunities, "Opportunity_ID");
  const roleById = makeLookup(roles, "Opportunity_Role_ID");
  const ewaByRolePerson = new Map<string, WorkbookRow>();
  for (const row of ewaRequests) {
    ewaByRolePerson.set(`${text(row.Opportunity_Role_ID)}|${text(row.Employee_ID)}`, row);
  }

  const feasibleRoleIds = distinct(
    overlays
      .filter(
        (row) =>
          asFloat(row.FTEGap) <= 0 &&
          (/^Recommended/i.test(text(row.FitStatus)) || /^Backup/i.test(text(row.FitStatus))),
      )
      .map((row) => text(row.Opportunity_Role_ID)),
  );
  const noDirectFitRows = bench.filter((row) => text(row.TargetRoleFit).toLowerCase().startsWith("no direct fit"));
  const summary = {
    datasetId: record.datasetId,
    sourceName: record.originalFileName,
    importedAt,
    kpis: {
      people: people.length,
      opportunities: opportunities.length,
      roles: roles.length,
      requiredFte: round(roles.reduce((sum, row) => sum + asFloat(row.FTERequired), 0)),
      availableFteCurrent: round(people.reduce((sum, row) => sum + asFloat(row.AvailableFTECurrent), 0)),
      currentBenchPeople: people.filter((row) => text(row.AvailabilityCategory) === "Current Bench").length,
      partialCapacityPeople: people.filter((row) => text(row.AvailabilityCategory) === "Partial Capacity").length,
      highRiskSupplyPeople: bench.filter((row) => text(row.BenchRisk) === "High").length,
      pendingEwaRequests: ewaRequests.filter((row) => text(row.EWAStatus) === "Pending Approval").length,
      feasibleRoles: feasibleRoleIds.length,
      totalRoles: roles.length,
      noDirectFitPeople: noDirectFitRows.length,
      noDirectFitFte: round(noDirectFitRows.reduce((sum, row) => sum + asFloat(row.BenchFTE), 0)),
    },
  };

  const availabilityByCategory = [...group(bench, (row) => text(row.AvailabilityCategory)).entries()]
    .map(([availabilityCategory, rows]) => ({
      availabilityCategory,
      people: rows.length,
      availableFte: round(rows.reduce((sum, row) => sum + asFloat(row.BenchFTE), 0)),
    }))
    .sort((left, right) => sortText(left.availabilityCategory, right.availabilityCategory));
  const supplyRiskByCategory = [...group(bench, (row) => `${text(row.AvailabilityCategory)}|${text(row.BenchRisk)}`).entries()]
    .map(([key, rows]) => {
      const [availabilityCategory, supplyRisk] = key.split("|");
      return {
        availabilityCategory,
        supplyRisk,
        people: rows.length,
        fte: round(rows.reduce((sum, row) => sum + asFloat(row.BenchFTE), 0)),
      };
    })
    .sort((left, right) => sortText(left.availabilityCategory, right.availabilityCategory) || riskRank(left.supplyRisk) - riskRank(right.supplyRisk));
  const peopleByDiscipline = [...group(people, (row) => text(row.Discipline) || "Unknown").entries()]
    .map(([discipline, rows]) => ({
      discipline,
      people: rows.length,
      availableFte: round(rows.reduce((sum, row) => sum + asFloat(row.AvailableFTECurrent), 0)),
    }))
    .sort((left, right) => right.availableFte - left.availableFte || right.people - left.people || sortText(left.discipline, right.discipline));
  const peopleByLocation = [...group(people, (row) => `${text(row.Country) || "Unknown"}|${text(row.City) || "Unknown"}`).entries()]
    .map(([key, rows]) => {
      const [country, city] = key.split("|");
      return {
        country,
        city,
        people: rows.length,
        availableFte: round(rows.reduce((sum, row) => sum + asFloat(row.AvailableFTECurrent), 0)),
      };
    })
    .sort((left, right) => right.availableFte - left.availableFte || right.people - left.people || sortText(left.country, right.country) || sortText(left.city, right.city));
  const highRiskPeople = bench
    .filter((row) => text(row.BenchRisk) === "High")
    .map((row) => {
      const person = peopleById.get(text(row.Employee_ID));
      return {
        personId: text(row.Employee_ID),
        name: text(person?.Employee_Name),
        discipline: text(person?.Discipline),
        grade: text(person?.Grade),
        city: text(person?.City),
        availabilityCategory: text(row.AvailabilityCategory),
        supplyFte: round(asFloat(row.BenchFTE)),
        timeOnSupplyDays: asInt(row.TimeOnBenchDays),
        suggestedAction: text(row.SuggestedAction),
      };
    })
    .sort((left, right) => right.timeOnSupplyDays - left.timeOnSupplyDays || sortText(left.name, right.name))
    .slice(0, 30);
  const supply = {
    availabilityByCategory,
    benchMovement: benchMovement
      .map((row) => ({
        weekStartDate: text(row.WeekStartDate),
        currentBenchHeadcount: asInt(row.CurrentBenchHeadcount),
        emergingBenchHeadcount: asInt(row.EmergingBenchHeadcount),
        partialCapacityHeadcount: asInt(row.PartialCapacityHeadcount),
        availableFte: round(asFloat(row.AvailableFTE)),
      }))
      .sort((left, right) => sortText(left.weekStartDate, right.weekStartDate)),
    supplyRiskByCategory,
    peopleByDiscipline,
    peopleByLocation,
    highRiskPeople,
  };

  const rolesByOpportunity = group(roles, (row) => text(row.Opportunity_ID));
  const demandByStage = [...group(opportunities, (row) => text(row.Stage)).entries()]
    .map(([stage, oppRows]) => {
      const oppRoleRows = oppRows.flatMap((row) => rolesByOpportunity.get(text(row.Opportunity_ID)) ?? []);
      return {
        stage,
        opportunities: oppRows.length,
        roles: oppRoleRows.length,
        requiredFte: round(oppRoleRows.reduce((sum, row) => sum + asFloat(row.FTERequired), 0)),
        avgProbability: round(average(oppRows.map((row) => asFloat(row.Probability))), 2),
      };
    })
    .sort((left, right) => stageRank(left.stage) - stageRank(right.stage) || sortText(left.stage, right.stage));
  const demandByRole = [...group(roles, (row) => text(row.RoleName)).entries()]
    .map(([roleName, rows]) => ({
      roleName,
      roles: rows.length,
      requiredFte: round(rows.reduce((sum, row) => sum + asFloat(row.FTERequired), 0)),
    }))
    .sort((left, right) => right.requiredFte - left.requiredFte || right.roles - left.roles || sortText(left.roleName, right.roleName));
  const deliveryRiskByPriority = [...group(roles, (row) => {
    const opportunity = opportunityById.get(text(row.Opportunity_ID));
    return `${text(opportunity?.DeliveryRisk)}|${text(opportunity?.CommercialPriority)}`;
  }).entries()]
    .map(([key, rows]) => {
      const [deliveryRisk, commercialPriority] = key.split("|");
      return {
        deliveryRisk,
        commercialPriority,
        opportunities: distinct(rows.map((row) => text(row.Opportunity_ID))).length,
        requiredFte: round(rows.reduce((sum, row) => sum + asFloat(row.FTERequired), 0)),
      };
    })
    .sort((left, right) => riskRank(left.deliveryRisk) - riskRank(right.deliveryRisk) || priorityRank(left.commercialPriority) - priorityRank(right.commercialPriority));
  const topOpportunities = opportunities
    .map((row) => {
      const oppRoles = rolesByOpportunity.get(text(row.Opportunity_ID)) ?? [];
      return {
        opportunityId: text(row.Opportunity_ID),
        name: text(row.Opportunity_Name),
        clientName: text(row.Client_Name),
        stage: text(row.Stage),
        probability: asFloat(row.Probability),
        deliveryRisk: text(row.DeliveryRisk),
        roles: oppRoles.length,
        requiredFte: round(oppRoles.reduce((sum, role) => sum + asFloat(role.FTERequired), 0)),
        expectedStartDate: text(row.ExpectedStartDate),
        commercialPriority: text(row.CommercialPriority),
      };
    })
    .sort((left, right) => priorityRank(left.commercialPriority) - priorityRank(right.commercialPriority) || right.probability - left.probability || sortText(left.expectedStartDate, right.expectedStartDate) || sortText(left.name, right.name))
    .slice(0, 10)
    .map(({ commercialPriority: _commercialPriority, ...row }) => row);
  const demand = { demandByStage, demandByRole, deliveryRiskByPriority, topOpportunities };

  const fitDistribution = [...group(overlays, (row) => text(row.FitStatus)).entries()]
    .map(([fitStatus, rows]) => ({
      fitStatus,
      candidates: rows.length,
      avgScore: round(average(rows.map((row) => asFloat(row.OverallStaffingScore)))),
      avgFteGap: round(average(rows.map((row) => asFloat(row.FTEGap)))),
    }))
    .sort((left, right) => right.candidates - left.candidates || right.avgScore - left.avgScore || sortText(left.fitStatus, right.fitStatus));
  const topCandidatePerRole = overlays
    .filter((row) => asInt(row.Rank) === 1)
    .map((row) => {
      const opportunity = opportunityById.get(text(row.Opportunity_ID));
      const role = roleById.get(text(row.Opportunity_Role_ID));
      const person = peopleById.get(text(row.Employee_ID));
      const ewa = ewaByRolePerson.get(`${text(row.Opportunity_Role_ID)}|${text(row.Employee_ID)}`);
      return {
        opportunityId: text(row.Opportunity_ID),
        opportunityName: text(opportunity?.Opportunity_Name),
        roleName: text(role?.RoleName),
        personId: text(row.Employee_ID),
        personName: text(person?.Employee_Name),
        fitStatus: text(row.FitStatus),
        rank: asInt(row.Rank),
        capabilityFitScore: round(asFloat(row.CapabilityFitScore)),
        availabilityFitScore: round(asFloat(row.AvailabilityFitScore)),
        overallStaffingScore: round(asFloat(row.OverallStaffingScore)),
        availableFteAtStart: round(asFloat(row.AvailableFTEAtStart)),
        fteGap: round(asFloat(row.FTEGap)),
        ewaStatus: text(ewa?.EWAStatus) || text(row.EWAStatus),
        priority: text(opportunity?.CommercialPriority),
        probability: asFloat(opportunity?.Probability),
        startDate: text(role?.StartDate),
      };
    })
    .sort((left, right) => priorityRank(left.priority) - priorityRank(right.priority) || right.probability - left.probability || sortText(left.startDate, right.startDate) || sortText(left.opportunityName, right.opportunityName) || sortText(left.roleName, right.roleName))
    .map(({ priority: _priority, probability: _probability, startDate: _startDate, ...row }) => row);
  const overlaysByRole = group(overlays, (row) => text(row.Opportunity_Role_ID));
  const rolesWithoutFeasibleCandidate = roles
    .filter((role) => {
      const roleOverlays = overlaysByRole.get(text(role.Opportunity_Role_ID)) ?? [];
      return !roleOverlays.some(
        (row) =>
          asFloat(row.FTEGap) <= 0 &&
          (/^Recommended/i.test(text(row.FitStatus)) || /^Backup/i.test(text(row.FitStatus))),
      );
    })
    .map((role) => {
      const opportunity = opportunityById.get(text(role.Opportunity_ID));
      return {
        opportunityId: text(role.Opportunity_ID),
        opportunityName: text(opportunity?.Opportunity_Name),
        roleName: text(role.RoleName),
        fteRequired: round(asFloat(role.FTERequired)),
        reason: (overlaysByRole.get(text(role.Opportunity_Role_ID)) ?? []).length ? "Availability or capability gap" : "No candidate overlay available",
        priority: text(opportunity?.CommercialPriority),
        probability: asFloat(opportunity?.Probability),
        startDate: text(role.StartDate),
      };
    })
    .sort((left, right) => priorityRank(left.priority) - priorityRank(right.priority) || right.probability - left.probability || sortText(left.startDate, right.startDate) || sortText(left.opportunityName, right.opportunityName) || sortText(left.roleName, right.roleName))
    .map(({ priority: _priority, probability: _probability, startDate: _startDate, ...row }) => row);
  const candidateOverlap = [...group(overlays, (row) => text(row.Employee_ID)).entries()]
    .map(([personId, rows]) => ({
      personId,
      personName: text(peopleById.get(personId)?.Employee_Name),
      opportunityCount: distinct(rows.map((row) => text(row.Opportunity_ID))).length,
      roleCount: distinct(rows.map((row) => text(row.Opportunity_Role_ID))).length,
      avgScore: round(average(rows.map((row) => asFloat(row.OverallStaffingScore)))),
      maxScore: round(Math.max(0, ...rows.map((row) => asFloat(row.OverallStaffingScore)))),
    }))
    .filter((row) => row.roleCount > 1)
    .sort((left, right) => right.roleCount - left.roleCount || right.maxScore - left.maxScore || right.avgScore - left.avgScore || sortText(left.personName, right.personName))
    .slice(0, 25);
  const staffingFit = { fitDistribution, topCandidatePerRole, rolesWithoutFeasibleCandidate, candidateOverlap };

  const requirementRows = roles.flatMap((role) => [
    ...parseSemicolonList(role.RequiredSkills).map((skillName) => ({
      roleId: text(role.Opportunity_Role_ID),
      skillName,
      importance: "REQUIRED",
    })),
    ...parseSemicolonList(role.DesiredSkills).map((skillName) => ({
      roleId: text(role.Opportunity_Role_ID),
      skillName,
      importance: "DESIRED",
    })),
  ]);
  const requiredSkillDemand = [...group(requirementRows, (row) => `${row.skillName}|${row.importance}`).entries()]
    .map(([key, rows]) => {
      const [skillName, importance] = key.split("|");
      return { skillName, importance, roleCount: distinct(rows.map((row) => row.roleId)).length };
    })
    .sort((left, right) => (left.importance === "REQUIRED" ? 0 : 1) - (right.importance === "REQUIRED" ? 0 : 1) || right.roleCount - left.roleCount || sortText(left.skillName, right.skillName));
  const skillSupply = [...group(skills, (row) => text(row.SkillName)).entries()]
    .map(([skillName, rows]) => ({
      skillName,
      people: distinct(rows.map((row) => text(row.Employee_ID))).length,
      avgLevel: round(average(rows.map((row) => asFloat(row.SkillLevel)))),
      avgYears: round(average(rows.map((row) => asFloat(row.YearsExperience)))),
    }))
    .sort((left, right) => right.people - left.people || right.avgLevel - left.avgLevel || right.avgYears - left.avgYears || sortText(left.skillName, right.skillName));
  const supplyBySkill = new Map(skillSupply.map((row) => [row.skillName, row.people]));
  const skillGaps = requiredSkillDemand
    .filter((row) => row.importance === "REQUIRED")
    .map((row) => ({
      skillName: row.skillName,
      requiredRoles: row.roleCount,
      people: supplyBySkill.get(row.skillName) ?? 0,
      gap: Math.max(row.roleCount - (supplyBySkill.get(row.skillName) ?? 0), 0),
    }))
    .filter((row) => row.gap > 0)
    .sort((left, right) => right.gap - left.gap || right.requiredRoles - left.requiredRoles || sortText(left.skillName, right.skillName));
  const skillsSection = { requiredSkillDemand, skillSupply, skillGaps, skillCatalogRows: skillCatalog.length };

  const ewaByStatus = [...group(ewaRequests, (row) => text(row.EWAStatus)).entries()]
    .map(([ewaStatus, rows]) => ({
      ewaStatus,
      requests: rows.length,
      requestedFte: round(rows.reduce((sum, row) => sum + asFloat(row.RequestedFTE), 0)),
    }))
    .sort((left, right) => ({ Blocked: 0, "Pending Approval": 1, Draft: 2 }[left.ewaStatus] ?? 3) - ({ Blocked: 0, "Pending Approval": 1, Draft: 2 }[right.ewaStatus] ?? 3) || sortText(left.ewaStatus, right.ewaStatus));
  const ewaQueue = ewaRequests
    .map((row) => {
      const opportunity = opportunityById.get(text(row.Opportunity_ID));
      const role = roleById.get(text(row.Opportunity_Role_ID));
      const person = peopleById.get(text(row.Employee_ID));
      return {
        ewaRequestId: text(row.EWA_Request_ID),
        opportunityName: text(opportunity?.Opportunity_Name),
        roleName: text(role?.RoleName),
        personName: text(person?.Employee_Name),
        requestType: text(row.RequestType),
        ewaStatus: text(row.EWAStatus),
        requestedFte: round(asFloat(row.RequestedFTE)),
        proposedStartDate: text(row.ProposedStartDate),
        blockingReason: optionalText(row.BlockingReason),
        nextAction: text(row.NextAction),
        lastUpdated: text(row.LastUpdated),
      };
    })
    .sort((left, right) => ({ Blocked: 0, "Pending Approval": 1, Draft: 2 }[left.ewaStatus] ?? 3) - ({ Blocked: 0, "Pending Approval": 1, Draft: 2 }[right.ewaStatus] ?? 3) || sortText(right.lastUpdated, left.lastUpdated) || sortText(left.proposedStartDate, right.proposedStartDate) || sortText(left.opportunityName, right.opportunityName))
    .slice(0, 50)
    .map(({ lastUpdated: _lastUpdated, ...row }) => row);
  const actionRequired = bench
    .filter((row) => text(row.BenchRisk) === "High" || text(row.EWAActionRequired).toLowerCase() === "yes")
    .map((row) => {
      const person = peopleById.get(text(row.Employee_ID));
      return {
        personId: text(row.Employee_ID),
        personName: text(person?.Employee_Name),
        supplyRisk: text(row.BenchRisk),
        suggestedAction: text(row.SuggestedAction),
        ewaActionRequired: text(row.EWAActionRequired),
        timeOnSupplyDays: asInt(row.TimeOnBenchDays),
      };
    })
    .sort((left, right) => riskRank(left.supplyRisk) - riskRank(right.supplyRisk) || right.timeOnSupplyDays - left.timeOnSupplyDays || sortText(left.personName, right.personName))
    .slice(0, 30)
    .map(({ timeOnSupplyDays: _timeOnSupplyDays, ...row }) => row);
  const ewa = { ewaByStatus, ewaQueue, actionRequired };

  return { summary, supply, demand, staffingFit, skills: skillsSection, ewa };
};

const createDashboardSnapshot = (
  record: Pick<CloudDatasetRecord, "datasetId" | "sourceSha256" | "originalFileName" | "workbookVersion" | "createdAt">,
  sections: WorkforceDashboardBundle,
): WorkforceStaticDashboardSnapshot => {
  const generatedAt = utcNowIsoWithOffset();
  const importedAt = text(sections.summary.importedAt) || generatedAt;
  return {
    schemaVersion: 1,
    generatedAt,
    source: {
      datasetId: record.datasetId,
      sourceSha256: record.sourceSha256,
      originalFileName: record.originalFileName,
      sourceName: text(sections.summary.sourceName) || record.originalFileName,
      workbookVersion: record.workbookVersion,
      createdAt: record.createdAt,
      importedAt,
    },
    history: [
      {
        generatedAt,
        trigger: "upload",
        sourceSha256: record.sourceSha256,
        importedAt,
      },
    ],
    sections,
  };
};

const buildImportCounts = (sheets: WorkbookSheets) => ({
  ImportBatch: 1,
  RawSheetRow: Object.values(sheets).reduce((sum, sheet) => sum + sheet.rows.length, 0),
  Person: sheetValues(sheets, "People").length,
  PersonAvailabilitySnapshot: sheetValues(sheets, "People").length,
  Profile: sheetValues(sheets, "Profiles").length,
  SkillCatalog: sheetValues(sheets, "Skill Catalog").length,
  PersonSkillEvidence: sheetValues(sheets, "Skills").length,
  CurrentAllocation: sheetValues(sheets, "Allocations").length,
  SupplyRecord: sheetValues(sheets, "Bench").length,
  PartialCapacityView: sheetValues(sheets, "Partial Capacity").length,
  AvailabilityWeek: sheetValues(sheets, "Availability Calendar").length,
  BenchMovementWeek: sheetValues(sheets, "Bench Movement").length,
  ProjectHistory: sheetValues(sheets, "Project History").length,
  Opportunity: sheetValues(sheets, "Opportunities").length,
  OpportunityRole: sheetValues(sheets, "Opportunity Roles").length,
  OpportunityRoleSkillRequirement: sheetValues(sheets, "Opportunity Roles").reduce(
    (sum, row) => sum + parseSemicolonList(row.RequiredSkills).length + parseSemicolonList(row.DesiredSkills).length,
    0,
  ),
  OpportunityCandidateOverlay: sheetValues(sheets, "Opportunity Overlays").length,
  EwaRequest: sheetValues(sheets, "EWA Requests").length,
  ScenarioTarget: sheetValues(sheets, "Scenario Targets").length,
});

const rawRowsForInsert = (datasetId: string, sheets: WorkbookSheets): D1Value[][] => {
  const rows: D1Value[][] = [];
  for (const [sheetName, sheet] of Object.entries(sheets)) {
    const naturalKeyColumn = NATURAL_KEY_COLUMNS[sheetName];
    for (const row of sheet.rows) {
      const payloadJson = rowPayloadJson(row.values);
      rows.push([
        datasetId,
        sheetName,
        row.rowNumber,
        naturalKeyColumn ? optionalText(row.values[naturalKeyColumn]) : null,
        fnvHash(payloadJson),
        payloadJson,
      ]);
    }
  }
  return rows;
};

export const createCloudDatasetFromUpload = async (
  db: D1DatabaseLike,
  bucket: R2BucketLike,
  file: File,
  options: {
    userId: string;
    label?: string | null;
    conversationId?: string | null;
    onProgress?: (update: WorkforceUploadProgressUpdate) => void | Promise<void>;
  },
) => {
  await ensureCloudSchema(db);
  const userId = text(options.userId);
  if (!(await getCloudDummyUserById(db, userId))) {
    throw new Error(`User not found: ${userId}`);
  }

  const originalFileName = text(file.name) || "workbook.xlsx";
  const datasetId = createDatasetId(originalFileName);
  const extension = originalFileName.toLowerCase().endsWith(".xlsx") ? ".xlsx" : ".xlsx";
  const excelFileName = `${datasetId}${extension}`;
  const dbFileName = `${datasetId}.d1`;
  const excelObjectKey = `workforce-datasets/${userId}/${datasetId}/${excelFileName}`;
  const bytes = new Uint8Array(await file.arrayBuffer());

  await options.onProgress?.({
    status: "processing",
    stage: "reading_workbook",
    stepIndex: 0,
    progress: 25,
    message: WORKFORCE_UPLOAD_STEP_LABELS[0],
    detail: "Reading sheet structure and validating required workbook tabs.",
  });

  const { sheets } = readWorkbookSheetsFromBuffer(bytes);
  ensureRequiredSheets(sheets);

  const createdAt = utcNowIsoWithOffset();
  const sourceSha256 = await hashBytes(bytes);
  const importedAt = createdAt;
  const importCounts = buildImportCounts(sheets);
  const baseRecord = {
    datasetId,
    ownerUserId: userId,
    label: options.label ? text(options.label) : null,
    dbFileName,
    excelFileName,
    originalFileName,
    workbookVersion: workbookVersion(sheets),
    createdAt,
    importCounts,
    conversationId: text(options.conversationId) || createConversationId(),
    sourceSha256,
    excelObjectKey,
    schemaValidation: null,
  };

  await options.onProgress?.({
    status: "processing",
    stage: "normalizing_skills",
    stepIndex: 1,
    progress: 55,
    message: WORKFORCE_UPLOAD_STEP_LABELS[1],
    detail: "Storing workbook bytes in R2 and normalizing workbook rows into D1.",
  });

  try {
    await bucket.put(excelObjectKey, bytes, {
      httpMetadata: {
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
    });

    await d1Run(db, `DELETE FROM "WorkforceRawSheetRow" WHERE "datasetId" = ?`, [datasetId]);
    await d1Many(
      db,
      `
      INSERT INTO "WorkforceRawSheetRow"
        ("datasetId", "sheetName", "sourceRowNumber", "naturalKey", "rowHash", "payloadJson")
      VALUES (?, ?, ?, ?, ?, ?)
      `,
      rawRowsForInsert(datasetId, sheets),
    );

    await options.onProgress?.({
      status: "processing",
      stage: "building_planning_table",
      stepIndex: 2,
      progress: 82,
      message: WORKFORCE_UPLOAD_STEP_LABELS[2],
      detail: "Building dashboard snapshot from the imported workforce rows.",
    });

    const sections = buildDashboardSections(sheets, baseRecord, importedAt);
    const staticDashboard = createDashboardSnapshot(baseRecord, sections);
    await d1Run(
      db,
      `
      INSERT INTO "WorkforceDataset" (
        "datasetId", "ownerUserId", "label", "dbFileName", "excelFileName",
        "originalFileName", "workbookVersion", "createdAt", "importCountsJson",
        "conversationId", "sourceSha256", "excelObjectKey", "staticDashboardJson",
        "schemaValidationJson"
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        baseRecord.datasetId,
        baseRecord.ownerUserId,
        baseRecord.label,
        baseRecord.dbFileName,
        baseRecord.excelFileName,
        baseRecord.originalFileName,
        baseRecord.workbookVersion,
        baseRecord.createdAt,
        JSON.stringify(baseRecord.importCounts),
        baseRecord.conversationId,
        baseRecord.sourceSha256,
        baseRecord.excelObjectKey,
        JSON.stringify(staticDashboard),
        null,
      ],
    );

    await options.onProgress?.({
      status: "processing",
      stage: "verifying_import",
      stepIndex: 2,
      progress: 92,
      message: WORKFORCE_UPLOAD_STEP_LABELS[2],
      detail: "D1 import completed. Finalizing the dataset record.",
      datasetId,
    });

    return {
      ...baseRecord,
      staticDashboard,
    } satisfies CloudDatasetRecord;
  } catch (error) {
    await bucket.delete(excelObjectKey).catch(() => undefined);
    await d1Run(db, `DELETE FROM "WorkforceRawSheetRow" WHERE "datasetId" = ?`, [datasetId]).catch(() => undefined);
    await d1Run(db, `DELETE FROM "WorkforceDataset" WHERE "datasetId" = ?`, [datasetId]).catch(() => undefined);
    throw error;
  }
};

export const listCloudDatasetRecordsForUser = async (db: D1DatabaseLike, userId: string) => {
  await ensureCloudSchema(db);
  const rows = await d1All(
    db,
    `
    SELECT *
    FROM "WorkforceDataset"
    WHERE "ownerUserId" = ?
    ORDER BY "createdAt" DESC
    `,
    [text(userId)],
  );
  return rows.map(toDatasetRecord);
};

export const readCloudDatasetRecord = async (db: D1DatabaseLike, datasetId: string) => {
  await ensureCloudSchema(db);
  const row = await d1First(db, `SELECT * FROM "WorkforceDataset" WHERE "datasetId" = ? LIMIT 1`, [text(datasetId)]);
  if (!row) {
    throw new Error(`Dataset not found: ${text(datasetId)}`);
  }
  return toDatasetRecord(row);
};

export const assertCloudDatasetOwnedByUser = async (db: D1DatabaseLike, datasetId: string, userId: string) => {
  const dataset = await readCloudDatasetRecord(db, datasetId);
  if (dataset.ownerUserId !== text(userId)) {
    throw new Error(`Dataset ${datasetId} does not belong to user ${text(userId)}.`);
  }
  return dataset;
};

export const attachCloudConversationToDataset = async (
  db: D1DatabaseLike,
  datasetId: string,
  conversationId: string,
) => {
  const dataset = await readCloudDatasetRecord(db, datasetId);
  const normalizedConversationId = text(conversationId);
  if (!normalizedConversationId || dataset.conversationId === normalizedConversationId) {
    return dataset;
  }
  await d1Run(db, `UPDATE "WorkforceDataset" SET "conversationId" = ? WHERE "datasetId" = ?`, [
    normalizedConversationId,
    dataset.datasetId,
  ]);
  return { ...dataset, conversationId: normalizedConversationId };
};

export const deleteCloudDatasetRecord = async (
  db: D1DatabaseLike,
  bucket: R2BucketLike,
  datasetId: string,
) => {
  const dataset = await readCloudDatasetRecord(db, datasetId);
  await bucket.delete(dataset.excelObjectKey).catch(() => undefined);
  await d1Run(db, `DELETE FROM "WorkforceRawSheetRow" WHERE "datasetId" = ?`, [dataset.datasetId]);
  await d1Run(db, `DELETE FROM "WorkforceDataset" WHERE "datasetId" = ?`, [dataset.datasetId]);
  return dataset;
};

export const readCloudWorkbookBytes = async (bucket: R2BucketLike, dataset: CloudDatasetRecord) => {
  const object = await bucket.get(dataset.excelObjectKey);
  if (!object) return null;
  return object.arrayBuffer();
};

export const readCloudRawWorkbookRows = async (
  db: D1DatabaseLike,
  datasetId: string,
  sheetName: string,
  limit: number,
  offset: number,
) => {
  await ensureCloudSchema(db);
  const sheets = await d1All<{ sheetName: string; rows: number }>(
    db,
    `
    SELECT "sheetName", COUNT(*) AS rows
    FROM "WorkforceRawSheetRow"
    WHERE "datasetId" = ?
    GROUP BY "sheetName"
    ORDER BY MIN("sourceRowNumber")
    `,
    [datasetId],
  );
  const selectedSheetName = sheets.find((sheet) => sheet.sheetName === sheetName)?.sheetName ?? sheets[0]?.sheetName ?? "";
  const rows = selectedSheetName
    ? await d1All<{ sourceRowNumber: number; naturalKey: string | null; payloadJson: string }>(
        db,
        `
        SELECT "sourceRowNumber", "naturalKey", "payloadJson"
        FROM "WorkforceRawSheetRow"
        WHERE "datasetId" = ? AND "sheetName" = ?
        ORDER BY "sourceRowNumber" ASC
        LIMIT ? OFFSET ?
        `,
        [datasetId, selectedSheetName, limit, offset],
      )
    : [];
  return {
    sheets: sheets.map((sheet) => ({ sheetName: text(sheet.sheetName), rows: asInt(sheet.rows) })),
    selectedSheetName,
    rows: rows.map((row) => ({
      sourceRowNumber: asInt(row.sourceRowNumber),
      naturalKey: text(row.naturalKey),
      payload: safeJsonParse<Record<string, unknown>>(row.payloadJson, {}),
    })),
  };
};

export type CloudSchemaPreviewColumn = {
  columnName: string;
  displayName: string;
  type: string;
  nullable: boolean;
  primaryKey: boolean;
};

export type CloudSchemaPreviewTable = {
  tableName: string;
  rowCount: number;
  columns: CloudSchemaPreviewColumn[];
  rows: Array<Record<string, string>>;
};

export type CloudSchemaValidationResult = {
  dataset: CloudDatasetClientRecord;
  validation: WorkforceSchemaValidationState;
  tables: CloudSchemaPreviewTable[];
};

const rawSheetTableOrder = Object.keys(NATURAL_KEY_COLUMNS);

const schemaValidationForCloudDataset = (dataset: CloudDatasetRecord) =>
  normalizeSchemaValidationState(dataset.schemaValidation) ?? pendingSchemaValidationState();

const cloudSchemaAliasMap = (dataset: CloudDatasetRecord) => {
  const aliases = new Map<string, Map<string, string>>();
  for (const table of schemaValidationForCloudDataset(dataset).tables) {
    aliases.set(
      table.tableName,
      new Map(table.columns.map((column) => [column.columnName, column.displayName])),
    );
  }
  return aliases;
};

const rawSheetOrder = (sheetName: string) => {
  const index = rawSheetTableOrder.indexOf(sheetName);
  return index === -1 ? rawSheetTableOrder.length + 1 : index;
};

const previewCellText = (value: unknown) => {
  if (value == null) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

const inferCloudColumnType = (values: unknown[]) => {
  const populated = values.filter((value) => value != null && value !== "");
  if (!populated.length) return "TEXT";
  if (populated.every((value) => typeof value === "boolean")) return "BOOLEAN";
  if (populated.every((value) => typeof value === "number")) return "REAL";
  return "TEXT";
};

const submittedCloudAliasMap = (tables: WorkforceSchemaValidationTableAlias[]) => {
  const aliases = new Map<string, Map<string, string>>();
  for (const table of tables) {
    const tableName = text(table.tableName);
    if (!tableName) continue;
    const columns = new Map<string, string>();
    for (const column of table.columns ?? []) {
      const columnName = text(column.columnName);
      if (!columnName) continue;
      columns.set(columnName, sanitizeSchemaDisplayName(column.displayName, columnName));
    }
    aliases.set(tableName, columns);
  }
  return aliases;
};

const readCloudSchemaPreviewTables = async (
  db: D1DatabaseLike,
  dataset: CloudDatasetRecord,
  sampleLimit = 8,
): Promise<CloudSchemaPreviewTable[]> => {
  await ensureCloudSchema(db);
  const sheets = (
    await d1All<{ sheetName: string; rows: number }>(
      db,
      `
      SELECT "sheetName", COUNT(*) AS rows
      FROM "WorkforceRawSheetRow"
      WHERE "datasetId" = ?
      GROUP BY "sheetName"
      `,
      [dataset.datasetId],
    )
  )
    .map((sheet) => ({ sheetName: text(sheet.sheetName), rows: asInt(sheet.rows) }))
    .filter((sheet) => sheet.sheetName)
    .sort((left, right) => rawSheetOrder(left.sheetName) - rawSheetOrder(right.sheetName) || left.sheetName.localeCompare(right.sheetName));
  const aliases = cloudSchemaAliasMap(dataset);
  const limit = Math.max(1, Math.min(Math.trunc(sampleLimit), 25));
  const tables: CloudSchemaPreviewTable[] = [];

  for (const sheet of sheets) {
    const rawRows = await d1All<{ payloadJson: string }>(
      db,
      `
      SELECT "payloadJson"
      FROM "WorkforceRawSheetRow"
      WHERE "datasetId" = ? AND "sheetName" = ?
      ORDER BY "sourceRowNumber" ASC
      LIMIT ?
      `,
      [dataset.datasetId, sheet.sheetName, limit],
    );
    const payloads = rawRows.map((row) => safeJsonParse<Record<string, unknown>>(row.payloadJson, {}));
    const columnNames = [...new Set(payloads.flatMap((payload) => Object.keys(payload)))];
    const tableAliases = aliases.get(sheet.sheetName) ?? new Map<string, string>();
    const naturalKeyColumn = NATURAL_KEY_COLUMNS[sheet.sheetName];
    const columns = columnNames.map((columnName) => {
      const values = payloads.map((payload) => payload[columnName]);
      return {
        columnName,
        displayName: tableAliases.get(columnName) ?? columnName,
        type: inferCloudColumnType(values),
        nullable: values.some((value) => value == null || value === ""),
        primaryKey: naturalKeyColumn === columnName,
      };
    });

    tables.push({
      tableName: sheet.sheetName,
      rowCount: sheet.rows,
      columns,
      rows: payloads.map((payload) =>
        Object.fromEntries(columns.map((column) => [column.columnName, previewCellText(payload[column.columnName])])),
      ),
    });
  }

  return tables;
};

const buildCloudSchemaValidationTables = (
  previewTables: CloudSchemaPreviewTable[],
  inputTables: WorkforceSchemaValidationTableAlias[],
): WorkforceSchemaValidationTableAlias[] => {
  const submitted = submittedCloudAliasMap(inputTables);
  return previewTables.map((table) => {
    const submittedColumns = submitted.get(table.tableName) ?? new Map<string, string>();
    return {
      tableName: table.tableName,
      columns: table.columns.map((column) => ({
        columnName: column.columnName,
        displayName: sanitizeSchemaDisplayName(
          submittedColumns.get(column.columnName) ?? column.displayName,
          column.columnName,
        ),
      })),
    };
  });
};

export const readCloudDatasetSchemaValidation = async (
  db: D1DatabaseLike,
  datasetId: string,
  userId: string,
): Promise<CloudSchemaValidationResult> => {
  const dataset = await assertCloudDatasetOwnedByUser(db, datasetId, userId);
  return {
    dataset: toClientDatasetRecord(dataset),
    validation: schemaValidationForCloudDataset(dataset),
    tables: await readCloudSchemaPreviewTables(db, dataset),
  };
};

export const validateCloudDatasetSchema = async (
  db: D1DatabaseLike,
  input: {
    datasetId: string;
    userId: string;
    tables: WorkforceSchemaValidationTableAlias[];
  },
): Promise<CloudSchemaValidationResult> => {
  const dataset = await assertCloudDatasetOwnedByUser(db, input.datasetId, input.userId);
  const currentValidation = schemaValidationForCloudDataset(dataset);
  if (currentValidation.status === "validated") {
    throw new SchemaValidationAlreadyCompletedError();
  }

  const previewTables = await readCloudSchemaPreviewTables(db, dataset);
  const tables = buildCloudSchemaValidationTables(previewTables, input.tables);
  const validation: WorkforceSchemaValidationState = {
    schemaVersion: WORKFORCE_SCHEMA_VALIDATION_VERSION,
    status: "validated",
    validatedAt: utcNowIsoWithOffset(),
    validatedByUserId: text(input.userId),
    tables,
  };

  await d1Run(
    db,
    `UPDATE "WorkforceDataset" SET "schemaValidationJson" = ? WHERE "datasetId" = ?`,
    [JSON.stringify(validation), dataset.datasetId],
  );

  const nextDataset = { ...dataset, schemaValidation: validation };
  return {
    dataset: toClientDatasetRecord(nextDataset),
    validation,
    tables: await readCloudSchemaPreviewTables(db, nextDataset),
  };
};

const titleFromMessage = (message: string) => {
  const cleaned = text(message).replace(/\s+/g, " ");
  if (!cleaned) return "New workforce chat";
  return cleaned.length > 72 ? `${cleaned.slice(0, 69)}...` : cleaned;
};

const parseDetails = (value: string | null): Record<string, unknown> | null => safeJsonParse<Record<string, unknown> | null>(value, null);

const toConversationSummary = (row: Record<string, unknown>): WorkforceConversationSummary => ({
  id: text(row.id),
  userId: text(row.user_id),
  datasetId: text(row.dataset_id),
  title: text(row.title),
  createdAt: text(row.created_at),
  updatedAt: text(row.updated_at),
  activeOpportunityId: optionalText(row.active_opportunity_id),
  activeOpportunityName: optionalText(row.active_opportunity_name),
  lastDetailView: optionalText(row.last_detail_view),
  lastSummary: optionalText(row.last_summary),
  messageCount: asInt(row.message_count),
  lastMessage: optionalText(row.last_message),
});

const toConversationMessage = (row: Record<string, unknown>): WorkforceConversationMessage => ({
  id: text(row.id),
  conversationId: text(row.conversation_id),
  role: text(row.role) === "assistant" ? "assistant" : "user",
  content: text(row.content),
  detailView: optionalText(row.detail_view),
  details: parseDetails(optionalText(row.details_json)),
  createdAt: text(row.created_at),
});

const readConversationRow = async (
  db: D1DatabaseLike,
  input: { conversationId: string; userId: string; datasetId?: string | null },
) => {
  const datasetId = text(input.datasetId);
  const row = await d1First(
    db,
    `
    SELECT c.*,
      COUNT(m.id) AS message_count,
      (
        SELECT content
        FROM conversation_messages lm
        WHERE lm.conversation_id = c.id
        ORDER BY lm.created_at DESC
        LIMIT 1
      ) AS last_message
    FROM conversations c
    LEFT JOIN conversation_messages m ON m.conversation_id = c.id
    WHERE c.id = ? AND c.user_id = ? ${datasetId ? "AND c.dataset_id = ?" : ""}
    GROUP BY c.id
    `,
    datasetId ? [input.conversationId, input.userId, datasetId] : [input.conversationId, input.userId],
  );
  if (!row) {
    throw new Error("Conversation not found.");
  }
  return row;
};

export const createCloudWorkforceConversation = async (
  db: D1DatabaseLike,
  input: {
    conversationId?: string | null;
    userId: string;
    datasetId: string;
    title?: string | null;
    firstMessage?: string | null;
  },
) => {
  const userId = text(input.userId);
  const datasetId = text(input.datasetId);
  await assertCloudDatasetOwnedByUser(db, datasetId, userId);
  const now = utcNowIsoWithOffset();
  const id = text(input.conversationId) || createConversationId();
  try {
    return toConversationSummary(await readConversationRow(db, { conversationId: id, userId, datasetId }));
  } catch {
    // Create below.
  }
  await d1Run(
    db,
    `
    INSERT INTO conversations (
      id, user_id, dataset_id, title, created_at, updated_at,
      active_opportunity_id, active_opportunity_name, last_detail_view, last_summary
    )
    VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL)
    `,
    [id, userId, datasetId, text(input.title) || titleFromMessage(input.firstMessage ?? ""), now, now],
  );
  await attachCloudConversationToDataset(db, datasetId, id);
  return toConversationSummary(await readConversationRow(db, { conversationId: id, userId, datasetId }));
};

export const getOrCreateCloudWorkforceConversation = async (
  db: D1DatabaseLike,
  input: {
    conversationId?: string | null;
    userId: string;
    datasetId: string;
    firstMessage?: string | null;
  },
) => {
  const conversationId = text(input.conversationId);
  if (!conversationId) {
    return createCloudWorkforceConversation(db, input);
  }
  try {
    await assertCloudDatasetOwnedByUser(db, input.datasetId, input.userId);
    return toConversationSummary(await readConversationRow(db, { conversationId, userId: text(input.userId), datasetId: input.datasetId }));
  } catch {
    return createCloudWorkforceConversation(db, { ...input, conversationId });
  }
};

export const listCloudWorkforceConversations = async (db: D1DatabaseLike, input: { userId: string; datasetId: string }) => {
  await assertCloudDatasetOwnedByUser(db, input.datasetId, input.userId);
  const rows = await d1All(
    db,
    `
    SELECT c.*,
      COUNT(m.id) AS message_count,
      (
        SELECT content
        FROM conversation_messages lm
        WHERE lm.conversation_id = c.id
        ORDER BY lm.created_at DESC
        LIMIT 1
      ) AS last_message
    FROM conversations c
    LEFT JOIN conversation_messages m ON m.conversation_id = c.id
    WHERE c.user_id = ? AND c.dataset_id = ?
    GROUP BY c.id
    HAVING COUNT(m.id) > 0
    ORDER BY c.updated_at DESC
    `,
    [text(input.userId), text(input.datasetId)],
  );
  return rows.map(toConversationSummary);
};

export const listCloudWorkforceConversationsForUser = async (db: D1DatabaseLike, input: { userId: string }) => {
  const rows = await d1All(
    db,
    `
    SELECT c.*,
      COUNT(m.id) AS message_count,
      (
        SELECT content
        FROM conversation_messages lm
        WHERE lm.conversation_id = c.id
        ORDER BY lm.created_at DESC
        LIMIT 1
      ) AS last_message
    FROM conversations c
    LEFT JOIN conversation_messages m ON m.conversation_id = c.id
    WHERE c.user_id = ?
    GROUP BY c.id
    HAVING COUNT(m.id) > 0
    ORDER BY c.updated_at DESC
    `,
    [text(input.userId)],
  );
  return rows.map(toConversationSummary);
};

export const readCloudWorkforceConversation = async (
  db: D1DatabaseLike,
  input: { conversationId: string; userId: string; datasetId?: string | null },
): Promise<WorkforceConversation> => {
  const summary = toConversationSummary(
    await readConversationRow(db, {
      conversationId: text(input.conversationId),
      userId: text(input.userId),
      datasetId: input.datasetId,
    }),
  );
  const rows = await d1All(
    db,
    `
    SELECT *
    FROM conversation_messages
    WHERE conversation_id = ?
    ORDER BY created_at ASC
    `,
    [summary.id],
  );
  return { ...summary, messages: rows.map(toConversationMessage) };
};

export const appendCloudWorkforceConversationMessage = async (
  db: D1DatabaseLike,
  input: {
    conversationId: string;
    role: WorkforceConversationRole;
    content: string;
    detailView?: string | null;
    details?: Record<string, unknown> | null;
  },
) => {
  const now = utcNowIsoWithOffset();
  const id = createMessageId();
  await d1Run(
    db,
    `
    INSERT INTO conversation_messages (
      id, conversation_id, role, content, detail_view, details_json, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    [
      id,
      text(input.conversationId),
      input.role,
      text(input.content),
      text(input.detailView) || null,
      input.details ? JSON.stringify(input.details) : null,
      now,
    ],
  );
  await d1Run(db, `UPDATE conversations SET updated_at = ? WHERE id = ?`, [now, text(input.conversationId)]);
  return {
    id,
    conversationId: text(input.conversationId),
    role: input.role,
    content: text(input.content),
    detailView: text(input.detailView) || null,
    details: input.details ?? null,
    createdAt: now,
  } satisfies WorkforceConversationMessage;
};

export const updateCloudWorkforceConversationMemory = async (
  db: D1DatabaseLike,
  input: {
    conversationId: string;
    activeOpportunityId?: string | null;
    activeOpportunityName?: string | null;
    lastDetailView?: string | null;
    lastSummary?: string | null;
    title?: string | null;
  },
) => {
  await d1Run(
    db,
    `
    UPDATE conversations
    SET active_opportunity_id = COALESCE(?, active_opportunity_id),
        active_opportunity_name = COALESCE(?, active_opportunity_name),
        last_detail_view = COALESCE(?, last_detail_view),
        last_summary = COALESCE(?, last_summary),
        title = CASE WHEN ? IS NOT NULL AND ? <> '' THEN ? ELSE title END,
        updated_at = ?
    WHERE id = ?
    `,
    [
      text(input.activeOpportunityId) || null,
      text(input.activeOpportunityName) || null,
      text(input.lastDetailView) || null,
      text(input.lastSummary) || null,
      text(input.title) || null,
      text(input.title) || null,
      text(input.title) || null,
      utcNowIsoWithOffset(),
      text(input.conversationId),
    ],
  );
};

export const deleteCloudWorkforceConversation = async (
  db: D1DatabaseLike,
  bucket: R2BucketLike,
  input: { conversationId: string; userId: string },
) => {
  const conversationId = text(input.conversationId);
  const userId = text(input.userId);
  const conversation = await readConversationRow(db, { conversationId, userId });
  const datasetId = text(conversation.dataset_id);
  await assertCloudDatasetOwnedByUser(db, datasetId, userId);
  const visibleConversationCount = await d1First<{ count: number }>(
    db,
    `
    SELECT COUNT(*) AS count
    FROM (
      SELECT c.id
      FROM conversations c
      JOIN conversation_messages m ON m.conversation_id = c.id
      WHERE c.user_id = ? AND c.dataset_id = ?
      GROUP BY c.id
    ) visible_conversations
    `,
    [userId, datasetId],
  );
  const shouldDeleteDataset = asInt(visibleConversationCount?.count) <= 1;
  let replacementConversationId: string | null = null;

  if (shouldDeleteDataset) {
    await d1Run(
      db,
      `DELETE FROM conversation_messages WHERE conversation_id IN (SELECT id FROM conversations WHERE user_id = ? AND dataset_id = ?)`,
      [userId, datasetId],
    );
    await d1Run(db, `DELETE FROM conversations WHERE user_id = ? AND dataset_id = ?`, [userId, datasetId]);
    await deleteCloudDatasetRecord(db, bucket, datasetId);
  } else {
    await d1Run(db, `DELETE FROM conversation_messages WHERE conversation_id = ?`, [conversationId]);
    await d1Run(db, `DELETE FROM conversations WHERE id = ? AND user_id = ?`, [conversationId, userId]);
    const replacement = await d1First<{ id: string }>(
      db,
      `
      SELECT c.id
      FROM conversations c
      JOIN conversation_messages m ON m.conversation_id = c.id
      WHERE c.user_id = ? AND c.dataset_id = ?
      GROUP BY c.id
      ORDER BY c.updated_at DESC
      LIMIT 1
      `,
      [userId, datasetId],
    );
    replacementConversationId = replacement?.id ?? null;
    if (replacementConversationId) {
      await attachCloudConversationToDataset(db, datasetId, replacementConversationId);
    }
  }

  return {
    conversationId,
    datasetId,
    datasetDeleted: shouldDeleteDataset,
    replacementConversationId,
  };
};

export const roles = () => [...DUMMY_USER_ROLES];

export const encodeBytesForResponse = (bytes: ArrayBuffer) => new Uint8Array(bytes);
