import { randomUUID, createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { WorkforceStaticDashboardSnapshot } from "./workforce-static-dashboard-cache";
import { importExcelToSqlite } from "./workforce-import";
import {
  normalizeSchemaValidationState,
  schemaValidationSummary,
  type WorkforceSchemaValidationState,
  type WorkforceSchemaValidationSummary,
} from "./workforce-schema-validation-types";
import type { WorkforceUploadProgressUpdate } from "./workforce-upload-progress";
import { ROOT_DIR, text, utcNowIsoWithOffset } from "./workforce-data-utils";

export const WORKFORCE_DATASETS_DIR = resolve(ROOT_DIR, "data", "workforce-datasets");

const DATASET_METADATA_FILE = "dataset.json";
const DATASET_METADATA_PATH_CACHE_LIMIT = 512;
const DATASET_RECORD_CACHE_LIMIT = 256;
const USER_DATASET_LIST_CACHE_LIMIT = 128;

const userDatasetsDir = (userId: string) => join(WORKFORCE_DATASETS_DIR, text(userId));
const datasetDirFor = (userId: string, datasetId: string) => join(userDatasetsDir(userId), datasetId);
const metadataPathInDatasetDir = (datasetDir: string) => join(datasetDir, DATASET_METADATA_FILE);

type DatasetRecordCacheEntry = {
  metadataPath: string;
  metadataMtimeMs: number;
  record: WorkforceDatasetRecord;
};

type UserDatasetListCacheEntry = {
  ownerDirMtimeMs: number;
  datasetIds: string[];
};

export type WorkforceDatasetRecord = {
  datasetId: string;
  ownerUserId: string;
  label: string | null;
  datasetDir: string;
  dbFileName: string;
  dbPath: string;
  excelFileName: string;
  excelPath: string;
  originalFileName: string;
  workbookVersion: string | null;
  createdAt: string;
  importCounts: Record<string, number>;
  conversationId: string | null;
  sourceSha256: string;
  staticDashboard?: WorkforceStaticDashboardSnapshot | null;
  schemaValidation?: WorkforceSchemaValidationState | null;
};

export type WorkforceDatasetClientRecord = {
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

export type CreateDatasetFromUploadOptions = {
  userId: string;
  label?: string | null;
  conversationId?: string | null;
  onProgress?: (update: WorkforceUploadProgressUpdate) => void;
};

const datasetMetadataPathCache = new Map<string, string>();
const datasetRecordCache = new Map<string, DatasetRecordCacheEntry>();
const userDatasetListCache = new Map<string, UserDatasetListCacheEntry>();

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

const createDatasetId = (originalFileName: string) => {
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const stem = slugify(originalFileName.replace(/\.[^.]+$/, "")) || "workbook";
  return `wf_${timestamp}_${stem}_${randomUUID().slice(0, 8)}`;
};

const createConversationId = () => `conv_${randomUUID()}`;

const ensureDatasetsDir = () => {
  mkdirSync(WORKFORCE_DATASETS_DIR, { recursive: true });
};

const cloneDatasetRecord = (record: WorkforceDatasetRecord): WorkforceDatasetRecord => structuredClone(record);

const getLruValue = <K, V>(cache: Map<K, V>, key: K) => {
  const value = cache.get(key);
  if (value === undefined) {
    return undefined;
  }

  cache.delete(key);
  cache.set(key, value);
  return value;
};

const setLruValue = <K, V>(cache: Map<K, V>, key: K, value: V, limit: number) => {
  if (cache.has(key)) {
    cache.delete(key);
  }

  cache.set(key, value);
  while (cache.size > limit) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    cache.delete(oldest);
  }
};

const getMtimeMs = (path: string) => {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
};

const cacheMetadataPath = (datasetId: string, metadataPath: string) => {
  setLruValue(datasetMetadataPathCache, datasetId, metadataPath, DATASET_METADATA_PATH_CACHE_LIMIT);
};

const invalidateUserDatasetListCache = (userId: string) => {
  userDatasetListCache.delete(text(userId));
};

const invalidateDatasetCaches = (datasetId: string, ownerUserId?: string | null) => {
  const cachedRecord = datasetRecordCache.get(datasetId);
  datasetRecordCache.delete(datasetId);
  datasetMetadataPathCache.delete(datasetId);

  const normalizedOwnerUserId = text(ownerUserId) || cachedRecord?.record.ownerUserId;
  if (normalizedOwnerUserId) {
    invalidateUserDatasetListCache(normalizedOwnerUserId);
  }
};

const cacheDatasetRecord = (
  record: WorkforceDatasetRecord,
  metadataPath: string,
  metadataMtimeMs = getMtimeMs(metadataPath),
) => {
  const normalizedRecord = normalizeDatasetRecord(record);
  cacheMetadataPath(normalizedRecord.datasetId, metadataPath);
  setLruValue(
    datasetRecordCache,
    normalizedRecord.datasetId,
    {
      metadataPath,
      metadataMtimeMs: metadataMtimeMs ?? Date.now(),
      record: cloneDatasetRecord(normalizedRecord),
    },
    DATASET_RECORD_CACHE_LIMIT,
  );
};

const resolveDatasetMetadataPath = (datasetId: string) => {
  ensureDatasetsDir();
  const normalizedDatasetId = text(datasetId) || datasetId;

  const cachedMetadataPath = getLruValue(datasetMetadataPathCache, normalizedDatasetId);
  if (cachedMetadataPath) {
    if (existsSync(cachedMetadataPath)) {
      return cachedMetadataPath;
    }

    datasetMetadataPathCache.delete(normalizedDatasetId);
    datasetRecordCache.delete(normalizedDatasetId);
  }

  const legacyPath = join(WORKFORCE_DATASETS_DIR, normalizedDatasetId, DATASET_METADATA_FILE);
  if (existsSync(legacyPath)) {
    cacheMetadataPath(normalizedDatasetId, legacyPath);
    return legacyPath;
  }

  for (const userEntry of readdirSync(WORKFORCE_DATASETS_DIR, { withFileTypes: true })) {
    if (!userEntry.isDirectory()) {
      continue;
    }

    const candidate = join(WORKFORCE_DATASETS_DIR, userEntry.name, normalizedDatasetId, DATASET_METADATA_FILE);
    if (existsSync(candidate)) {
      cacheMetadataPath(normalizedDatasetId, candidate);
      return candidate;
    }
  }

  return null;
};

const readImportBatchSummary = (dbPath: string) => {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return (
      db.prepare(
        `
          SELECT workbookName, workbookVersion, importedAt
          FROM "ImportBatch"
          ORDER BY id DESC
          LIMIT 1
        `,
      ).get() as { workbookName: string; workbookVersion: string | null; importedAt: string } | undefined
    ) ?? null;
  } finally {
    db.close();
  }
};

const normalizeDatasetRecord = (value: unknown): WorkforceDatasetRecord => {
  const { conversationIds, ...record } = value as WorkforceDatasetRecord & { conversationIds?: string[] };
  const legacyConversationIds = Array.isArray(conversationIds)
    ? conversationIds.map(text).filter(Boolean)
    : [];
  return {
    ...record,
    conversationId: text(record.conversationId) || legacyConversationIds.at(-1) || null,
    schemaValidation: normalizeSchemaValidationState(record.schemaValidation),
  };
};

export const toClientDatasetRecord = (record: WorkforceDatasetRecord): WorkforceDatasetClientRecord => ({
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

export const writeDatasetRecord = (record: WorkforceDatasetRecord) => {
  const metadataPath = metadataPathInDatasetDir(record.datasetDir);
  writeFileSync(metadataPath, JSON.stringify(record, null, 2), "utf8");
  cacheDatasetRecord(record, metadataPath);
  invalidateUserDatasetListCache(record.ownerUserId);
};

export const deleteDatasetRecord = (datasetId: string) => {
  const record = readDatasetRecord(datasetId);
  rmSync(record.datasetDir, { recursive: true, force: true });

  const ownerDir = userDatasetsDir(record.ownerUserId);
  if (existsSync(ownerDir) && readdirSync(ownerDir).length === 0) {
    rmSync(ownerDir, { recursive: true, force: true });
  }

  invalidateDatasetCaches(record.datasetId, record.ownerUserId);
};

export const readDatasetRecord = (datasetId: string): WorkforceDatasetRecord => {
  const normalizedDatasetId = text(datasetId) || datasetId;
  const cachedEntry = getLruValue(datasetRecordCache, normalizedDatasetId);
  if (cachedEntry) {
    const cachedMtimeMs = getMtimeMs(cachedEntry.metadataPath);
    if (cachedMtimeMs != null && cachedMtimeMs === cachedEntry.metadataMtimeMs) {
      return cloneDatasetRecord(cachedEntry.record);
    }

    invalidateDatasetCaches(normalizedDatasetId, cachedEntry.record.ownerUserId);
  }

  const metadataPath = resolveDatasetMetadataPath(normalizedDatasetId);
  if (!metadataPath || !existsSync(metadataPath)) {
    throw new Error(`Dataset not found: ${normalizedDatasetId}`);
  }

  const metadataMtimeMs = getMtimeMs(metadataPath);
  const record = normalizeDatasetRecord(JSON.parse(readFileSync(metadataPath, "utf8")));
  cacheDatasetRecord(record, metadataPath, metadataMtimeMs);
  return cloneDatasetRecord(record);
};

export const listDatasetRecordsForUser = (userId: string): WorkforceDatasetRecord[] => {
  const normalizedUserId = text(userId);
  const ownerDir = userDatasetsDir(normalizedUserId);
  if (!existsSync(ownerDir)) {
    invalidateUserDatasetListCache(normalizedUserId);
    return [];
  }

  const ownerDirMtimeMs = getMtimeMs(ownerDir) ?? Date.now();
  const cachedList = getLruValue(userDatasetListCache, normalizedUserId);
  const datasetIds =
    cachedList && cachedList.ownerDirMtimeMs === ownerDirMtimeMs
      ? cachedList.datasetIds
      : readdirSync(ownerDir, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .flatMap((entry) => {
            const metadataPath = metadataPathInDatasetDir(join(ownerDir, entry.name));
            if (!existsSync(metadataPath)) {
              return [];
            }

            cacheMetadataPath(entry.name, metadataPath);
            return [entry.name];
          });

  if (!cachedList || cachedList.ownerDirMtimeMs !== ownerDirMtimeMs) {
    setLruValue(
      userDatasetListCache,
      normalizedUserId,
      {
        ownerDirMtimeMs,
        datasetIds,
      },
      USER_DATASET_LIST_CACHE_LIMIT,
    );
  }

  const records = datasetIds
    .flatMap((datasetIdFromList) => {
      try {
        return [readDatasetRecord(datasetIdFromList)];
      } catch {
        return [];
      }
    })
    .filter((record): record is WorkforceDatasetRecord => record != null && record.ownerUserId === normalizedUserId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  if (records.length !== datasetIds.length) {
    setLruValue(
      userDatasetListCache,
      normalizedUserId,
      {
        ownerDirMtimeMs,
        datasetIds: records.map((record) => record.datasetId),
      },
      USER_DATASET_LIST_CACHE_LIMIT,
    );
  }

  return records;
};

export const assertDatasetOwnedByUser = (datasetId: string, userId: string) => {
  const record = readDatasetRecord(datasetId);
  if (record.ownerUserId !== text(userId)) {
    throw new Error(`Dataset ${datasetId} does not belong to user ${text(userId)}.`);
  }
  return record;
};

export const resolveDatasetDbPath = (datasetId: string) => {
  const record = readDatasetRecord(datasetId);
  if (!existsSync(record.dbPath)) {
    throw new Error(`SQLite database not found for dataset ${datasetId}: ${record.dbPath}`);
  }
  return record.dbPath;
};

export const resolveWorkforceDataSource = (input: { dbPath?: string; datasetId?: string }) => {
  if (input.datasetId) {
    const dataset = readDatasetRecord(input.datasetId);
    if (!existsSync(dataset.dbPath)) {
      throw new Error(`SQLite database not found for dataset ${input.datasetId}: ${dataset.dbPath}`);
    }
    return {
      datasetId: dataset.datasetId,
      dataset,
      dbPath: dataset.dbPath,
    };
  }

  if (!input.dbPath) {
    throw new Error("Either datasetId or dbPath is required.");
  }

  return {
    datasetId: null,
    dataset: null,
    dbPath: resolve(input.dbPath),
  };
};

export const attachConversationToDataset = (datasetId: string, conversationId: string) => {
  const normalizedConversationId = text(conversationId);
  if (!normalizedConversationId) {
    return readDatasetRecord(datasetId);
  }

  const record = readDatasetRecord(datasetId);
  if (record.conversationId === normalizedConversationId) {
    return record;
  }
  record.conversationId = normalizedConversationId;
  writeDatasetRecord(record);
  return record;
};

export async function createDatasetFromUpload(
  file: File,
  options: CreateDatasetFromUploadOptions,
): Promise<WorkforceDatasetRecord> {
  const normalizedUserId = text(options.userId);
  const originalFileName = text(file.name) || "workbook.xlsx";
  const datasetId = createDatasetId(originalFileName);
  const datasetDir = datasetDirFor(normalizedUserId, datasetId);
  const extension = extname(originalFileName) || ".xlsx";
  const excelFileName = `${datasetId}${extension.toLowerCase()}`;
  const dbFileName = `${datasetId}.db`;
  const excelPath = join(datasetDir, excelFileName);
  const dbPath = join(datasetDir, dbFileName);

  ensureDatasetsDir();
  mkdirSync(datasetDir, { recursive: true });

  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    writeFileSync(excelPath, bytes);

    const importResult = await importExcelToSqlite({
      excelPath,
      dbPath,
      replace: true,
      workbookName: originalFileName,
      onProgress: options.onProgress,
    });

    const importBatch = readImportBatchSummary(dbPath);
    const record: WorkforceDatasetRecord = {
      datasetId,
      ownerUserId: normalizedUserId,
      label: options.label ? text(options.label) : null,
      datasetDir,
      dbFileName,
      dbPath,
      excelFileName,
      excelPath,
      originalFileName,
      workbookVersion: importBatch?.workbookVersion ?? null,
      createdAt: utcNowIsoWithOffset(),
      importCounts: importResult.counts,
      conversationId: text(options.conversationId) || createConversationId(),
      sourceSha256: createHash("sha256").update(bytes).digest("hex"),
      staticDashboard: null,
      schemaValidation: null,
    };

    writeDatasetRecord(record);
    return record;
  } catch (error) {
    rmSync(datasetDir, { recursive: true, force: true });
    throw error;
  }
}
