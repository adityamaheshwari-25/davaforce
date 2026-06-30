import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  assertDatasetOwnedByUser,
  toClientDatasetRecord,
  writeDatasetRecord,
  type WorkforceDatasetClientRecord,
  type WorkforceDatasetRecord,
} from "./workforce-dataset-store";
import { text, utcNowIsoWithOffset } from "./workforce-data-utils";
import {
  WORKFORCE_SCHEMA_VALIDATION_VERSION,
  SchemaValidationAlreadyCompletedError,
  normalizeSchemaValidationState,
  pendingSchemaValidationState,
  sanitizeSchemaDisplayName,
  type WorkforceSchemaValidationState,
  type WorkforceSchemaValidationTableAlias,
} from "./workforce-schema-validation-types";

export type WorkforceSchemaPreviewColumn = {
  columnName: string;
  displayName: string;
  type: string;
  nullable: boolean;
  primaryKey: boolean;
};

export type WorkforceSchemaPreviewTable = {
  tableName: string;
  rowCount: number;
  columns: WorkforceSchemaPreviewColumn[];
  rows: Array<Record<string, string>>;
};

export type WorkforceSchemaValidationResult = {
  dataset: WorkforceDatasetClientRecord;
  validation: WorkforceSchemaValidationState;
  tables: WorkforceSchemaPreviewTable[];
};

export type WorkforceSchemaValidationInput = {
  datasetId: string;
  userId: string;
  tables: WorkforceSchemaValidationTableAlias[];
};

const SCHEMA_HEADER_ALIAS_TABLE = "DatasetSchemaHeader";
const INTERNAL_SCHEMA_VALIDATION_TABLES = new Set(["ImportBatch", "RawSheetRow"]);

const CREATED_TABLE_ORDER = [
  "ImportBatch",
  "RawSheetRow",
  "Person",
  "PersonAvailabilitySnapshot",
  "Profile",
  "SkillCatalog",
  "PersonSkillEvidence",
  "CurrentAllocation",
  "SupplyRecord",
  "PartialCapacityView",
  "AvailabilityWeek",
  "BenchMovementWeek",
  "ProjectHistory",
  "Opportunity",
  "OpportunityRole",
  "OpportunityRoleSkillRequirement",
  "OpportunityCandidateOverlay",
  "EwaRequest",
  "ScenarioTarget",
];

type SqliteTableInfoRow = {
  name: string;
  type: string;
  notnull: number | bigint;
  pk: number | bigint;
};

const quoteIdentifier = (value: string) => `"${value.replace(/"/g, '""')}"`;

const asNumber = (value: unknown) => {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  return Number(value ?? 0) || 0;
};

const previewCellValue = (value: unknown) => {
  if (value == null) return "";
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return `[${value.byteLength} bytes]`;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

const tableOrder = (tableName: string) => {
  const index = CREATED_TABLE_ORDER.indexOf(tableName);
  return index === -1 ? CREATED_TABLE_ORDER.length + 1 : index;
};

const validationStateForRecord = (record: WorkforceDatasetRecord): WorkforceSchemaValidationState =>
  normalizeSchemaValidationState(record.schemaValidation) ?? pendingSchemaValidationState();

const aliasMapForRecord = (record: WorkforceDatasetRecord) => {
  const aliases = new Map<string, Map<string, string>>();
  for (const table of validationStateForRecord(record).tables) {
    aliases.set(
      table.tableName,
      new Map(table.columns.map((column) => [column.columnName, column.displayName])),
    );
  }
  return aliases;
};

const readSqliteTables = (db: DatabaseSync) =>
  (
    db
      .prepare(
        `
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name NOT LIKE 'sqlite_%'
        `,
      )
      .all() as Array<{ name: string }>
    )
    .map((row) => text(row.name))
    .filter((name) => name && name !== SCHEMA_HEADER_ALIAS_TABLE && !INTERNAL_SCHEMA_VALIDATION_TABLES.has(name))
    .sort((left, right) => tableOrder(left) - tableOrder(right) || left.localeCompare(right));

const readPreviewTables = (
  record: WorkforceDatasetRecord,
  options: { sampleLimit?: number } = {},
): WorkforceSchemaPreviewTable[] => {
  if (!existsSync(record.dbPath)) {
    throw new Error(`SQLite database not found for dataset ${record.datasetId}: ${record.dbPath}`);
  }

  const db = new DatabaseSync(record.dbPath, { readOnly: true });
  const sampleLimit = Math.max(1, Math.min(Math.trunc(options.sampleLimit ?? 8), 25));
  const aliases = aliasMapForRecord(record);

  try {
    return readSqliteTables(db).map((tableName) => {
      const quotedTableName = quoteIdentifier(tableName);
      const tableAliases = aliases.get(tableName) ?? new Map<string, string>();
      const columns = (db.prepare(`PRAGMA table_info(${quotedTableName})`).all() as SqliteTableInfoRow[]).map(
        (column) => {
          const columnName = text(column.name);
          return {
            columnName,
            displayName: tableAliases.get(columnName) ?? columnName,
            type: text(column.type) || "ANY",
            nullable: asNumber(column.notnull) === 0,
            primaryKey: asNumber(column.pk) > 0,
          };
        },
      );
      const rowCount = asNumber(
        (db.prepare(`SELECT COUNT(*) AS rowCount FROM ${quotedTableName}`).get() as { rowCount?: unknown } | undefined)
          ?.rowCount,
      );
      const rows = (db.prepare(`SELECT * FROM ${quotedTableName} LIMIT ?`).all(sampleLimit) as Array<Record<string, unknown>>).map(
        (row) =>
          Object.fromEntries(
            columns.map((column) => [column.columnName, previewCellValue(row[column.columnName])]),
          ),
      );

      return {
        tableName,
        rowCount,
        columns,
        rows,
      };
    });
  } finally {
    db.close();
  }
};

const submittedAliasMap = (tables: WorkforceSchemaValidationTableAlias[]) => {
  const map = new Map<string, Map<string, string>>();
  for (const table of tables) {
    const tableName = text(table.tableName);
    if (!tableName) continue;
    const columns = new Map<string, string>();
    for (const column of table.columns ?? []) {
      const columnName = text(column.columnName);
      if (!columnName) continue;
      columns.set(columnName, sanitizeSchemaDisplayName(column.displayName, columnName));
    }
    map.set(tableName, columns);
  }
  return map;
};

const buildValidationTables = (
  previewTables: WorkforceSchemaPreviewTable[],
  inputTables: WorkforceSchemaValidationTableAlias[],
): WorkforceSchemaValidationTableAlias[] => {
  const submitted = submittedAliasMap(inputTables);
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

const persistSchemaAliasesToSqlite = (
  record: WorkforceDatasetRecord,
  tables: WorkforceSchemaValidationTableAlias[],
) => {
  if (!existsSync(record.dbPath)) {
    throw new Error(`SQLite database not found for dataset ${record.datasetId}: ${record.dbPath}`);
  }

  const db = new DatabaseSync(record.dbPath);
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS "${SCHEMA_HEADER_ALIAS_TABLE}" (
        "tableName" TEXT NOT NULL,
        "columnName" TEXT NOT NULL,
        "displayName" TEXT NOT NULL,
        PRIMARY KEY ("tableName", "columnName")
      )
    `);

    const insert = db.prepare(
      `
      INSERT INTO "${SCHEMA_HEADER_ALIAS_TABLE}" ("tableName", "columnName", "displayName")
      VALUES (?, ?, ?)
      `,
    );

    db.exec("BEGIN");
    try {
      db.prepare(`DELETE FROM "${SCHEMA_HEADER_ALIAS_TABLE}"`).run();
      for (const table of tables) {
        for (const column of table.columns) {
          insert.run(table.tableName, column.columnName, column.displayName);
        }
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } finally {
    db.close();
  }
};

export const readDatasetSchemaValidation = (
  datasetId: string,
  userId: string,
): WorkforceSchemaValidationResult => {
  const record = assertDatasetOwnedByUser(datasetId, userId);
  return {
    dataset: toClientDatasetRecord(record),
    validation: validationStateForRecord(record),
    tables: readPreviewTables(record),
  };
};

export const validateDatasetSchema = (
  input: WorkforceSchemaValidationInput,
): WorkforceSchemaValidationResult => {
  const record = assertDatasetOwnedByUser(input.datasetId, input.userId);
  const currentValidation = validationStateForRecord(record);
  if (currentValidation.status === "validated") {
    throw new SchemaValidationAlreadyCompletedError();
  }

  const previewTables = readPreviewTables(record);
  const tables = buildValidationTables(previewTables, input.tables);
  persistSchemaAliasesToSqlite(record, tables);

  const nextValidation: WorkforceSchemaValidationState = {
    schemaVersion: WORKFORCE_SCHEMA_VALIDATION_VERSION,
    status: "validated",
    validatedAt: utcNowIsoWithOffset(),
    validatedByUserId: text(input.userId),
    tables,
  };
  const nextRecord: WorkforceDatasetRecord = {
    ...record,
    schemaValidation: nextValidation,
  };
  writeDatasetRecord(nextRecord);

  return {
    dataset: toClientDatasetRecord(nextRecord),
    validation: nextValidation,
    tables: readPreviewTables(nextRecord),
  };
};
