export const WORKFORCE_SCHEMA_VALIDATION_VERSION = 1;

export type WorkforceSchemaValidationStatus = "pending" | "validated";

export type WorkforceSchemaValidationColumnAlias = {
  columnName: string;
  displayName: string;
};

export type WorkforceSchemaValidationTableAlias = {
  tableName: string;
  columns: WorkforceSchemaValidationColumnAlias[];
};

export type WorkforceSchemaValidationState = {
  schemaVersion: typeof WORKFORCE_SCHEMA_VALIDATION_VERSION;
  status: WorkforceSchemaValidationStatus;
  validatedAt: string | null;
  validatedByUserId: string | null;
  tables: WorkforceSchemaValidationTableAlias[];
};

export type WorkforceSchemaValidationSummary = {
  status: WorkforceSchemaValidationStatus;
  validatedAt: string | null;
};

export class SchemaValidationAlreadyCompletedError extends Error {
  constructor() {
    super("Dataset schema has already been validated.");
  }
}

const asText = (value: unknown) => String(value ?? "").trim();

export const sanitizeSchemaDisplayName = (value: unknown, fallback: string) => {
  const cleaned = asText(value).replace(/\s+/g, " ");
  return (cleaned || fallback).slice(0, 96);
};

export const pendingSchemaValidationState = (): WorkforceSchemaValidationState => ({
  schemaVersion: WORKFORCE_SCHEMA_VALIDATION_VERSION,
  status: "pending",
  validatedAt: null,
  validatedByUserId: null,
  tables: [],
});

export const normalizeSchemaValidationState = (
  value: unknown,
): WorkforceSchemaValidationState | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<WorkforceSchemaValidationState>;
  if (candidate.schemaVersion !== WORKFORCE_SCHEMA_VALIDATION_VERSION) {
    return null;
  }

  if (candidate.status !== "validated" && candidate.status !== "pending") {
    return null;
  }

  const tables = Array.isArray(candidate.tables)
    ? candidate.tables.flatMap((table) => {
        const tableName = asText(table?.tableName);
        if (!tableName || !Array.isArray(table?.columns)) {
          return [];
        }

        return [
          {
            tableName,
            columns: table.columns.flatMap((column) => {
              const columnName = asText(column?.columnName);
              if (!columnName) {
                return [];
              }

              return [
                {
                  columnName,
                  displayName: sanitizeSchemaDisplayName(column?.displayName, columnName),
                },
              ];
            }),
          },
        ];
      })
    : [];

  return {
    schemaVersion: WORKFORCE_SCHEMA_VALIDATION_VERSION,
    status: candidate.status,
    validatedAt: asText(candidate.validatedAt) || null,
    validatedByUserId: asText(candidate.validatedByUserId) || null,
    tables,
  };
};

export const schemaValidationSummary = (
  value: WorkforceSchemaValidationState | null | undefined,
): WorkforceSchemaValidationSummary => {
  const normalized = normalizeSchemaValidationState(value);
  if (!normalized || normalized.status !== "validated") {
    return {
      status: "pending",
      validatedAt: null,
    };
  }

  return {
    status: "validated",
    validatedAt: normalized.validatedAt,
  };
};
