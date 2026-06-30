export type WorkforceSchemaValidationStatus = "pending" | "validated";

export type WorkforceSchemaValidationSummary = {
  status: WorkforceSchemaValidationStatus;
  validatedAt: string | null;
};

export type WorkforceSchemaValidationColumn = {
  columnName: string;
  displayName: string;
  type: string;
  nullable: boolean;
  primaryKey: boolean;
};

export type WorkforceSchemaValidationTable = {
  tableName: string;
  rowCount: number;
  columns: WorkforceSchemaValidationColumn[];
  rows: Array<Record<string, string>>;
};

export type WorkforceSchemaValidationDataset = {
  datasetId: string;
  ownerUserId: string;
  originalFileName: string;
  label: string | null;
  schemaValidation: WorkforceSchemaValidationSummary;
};

export type WorkforceSchemaValidationPayload = {
  status: "success" | "failure";
  dataset?: WorkforceSchemaValidationDataset;
  validation?: WorkforceSchemaValidationSummary & {
    tables?: Array<{
      tableName: string;
      columns: Array<{ columnName: string; displayName: string }>;
    }>;
  };
  tables?: WorkforceSchemaValidationTable[];
  error?: string;
};

export type StoredWorkforceUser = {
  userId?: string;
  username?: string;
};

export const getStoredWorkforceIdentity = () => {
  const storedUser = window.localStorage.getItem("workforceUser");
  const user = storedUser ? (JSON.parse(storedUser) as StoredWorkforceUser | null) : null;
  return {
    userId: user?.userId ?? "",
    datasetId: window.localStorage.getItem("workforceDatasetId") ?? "",
  };
};

export const loadSchemaValidation = async (userId: string, datasetId: string) => {
  const params = new URLSearchParams({ userId, datasetId });
  const response = await fetch(`/api/workforce-datasets/schema-validation?${params.toString()}`, {
    cache: "no-store",
  });
  const payload = (await response.json()) as WorkforceSchemaValidationPayload;

  if (!response.ok || payload.status !== "success" || !payload.dataset || !payload.validation || !payload.tables) {
    throw new Error(payload.error ?? "Failed to load schema validation.");
  }

  return {
    dataset: payload.dataset,
    validation: payload.validation,
    tables: payload.tables,
  };
};

export const isDatasetSchemaValidated = async (userId: string, datasetId: string) => {
  const { validation } = await loadSchemaValidation(userId, datasetId);
  return validation.status === "validated";
};
