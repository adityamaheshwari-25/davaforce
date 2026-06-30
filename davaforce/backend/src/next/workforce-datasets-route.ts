import {
  existsSync,
  readFileSync,
} from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  attachConversationToDataset,
  assertDatasetOwnedByUser,
  createDatasetFromUpload,
  deleteDatasetRecord,
  listDatasetRecordsForUser,
  toClientDatasetRecord,
} from "../lib/workforce-dataset-store";
import { assertDummyUserExists } from "../lib/dummy-users-store";
import { ensureDatasetStaticDashboard } from "../lib/workforce-static-dashboard-cache";
import {
  getUploadProgressSession,
  isTerminalUploadStatus,
  parseUploadId,
  publishUploadProgress,
  subscribeToUploadProgress,
  WORKFORCE_UPLOAD_STEP_LABELS,
} from "../lib/workforce-upload-progress";
import { verifyImportedDatabase } from "../lib/workforce-verify";
import {
  readDatasetSchemaValidation,
  validateDatasetSchema,
  type WorkforceSchemaValidationInput,
} from "../lib/workforce-schema-validation";
import { SchemaValidationAlreadyCompletedError } from "../lib/workforce-schema-validation-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) => Response.json(body, { status });
type Row = Record<string, unknown>;

const sseHeaders = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
} as const;

const yieldToEventLoop = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const all = (db: DatabaseSync, sql: string, params: any[] = []) => db.prepare(sql).all(...params) as Row[];

const safeDownloadFileName = (value: string) =>
  (value || "workforce-workbook.xlsx")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim() || "workforce-workbook.xlsx";

const requireOwnedDatasetFromSearch = (request: Request) => {
  const { searchParams } = new URL(request.url);
  const datasetId = searchParams.get("datasetId")?.trim();
  const userId = searchParams.get("userId")?.trim();

  if (!userId || !datasetId) {
    throw new Error("userId and datasetId are required.");
  }

  assertDummyUserExists(userId);
  return assertDatasetOwnedByUser(datasetId, userId);
};

type UploadContext = {
  uploadId: string;
  userId: string;
};

const getTextField = (value: FormDataEntryValue | null) => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
};

const requireText = (value: string | null, fieldName: string) => {
  if (!value) {
    throw new Error(`${fieldName} is required.`);
  }
  return value;
};

const getUploadFile = (formData: FormData) => {
  const candidate = formData.get("file") ?? formData.get("excel") ?? formData.get("workbook");
  if (!(candidate instanceof File)) {
    throw new Error("Expected a multipart file field named file, excel, or workbook.");
  }
  if (!candidate.name.toLowerCase().endsWith(".xlsx")) {
    throw new Error("Only .xlsx workbooks are supported.");
  }
  return candidate;
};

const getRequestedUploadId = (request: Request, formData?: FormData) =>
  parseUploadId(
    getTextField(formData?.get("uploadId") ?? formData?.get("progressId") ?? null) ??
      request.headers.get("x-upload-id"),
  );

const getUploadContext = (request: Request, formData: FormData): UploadContext => {
  const userId = requireText(getTextField(formData.get("userId")), "userId");
  assertDummyUserExists(userId);

  const session = getUploadProgressSession({
    userId,
    uploadId: getRequestedUploadId(request, formData),
  });

  return {
    uploadId: session.uploadId,
    userId,
  };
};

const tryPublishFailure = (context: UploadContext | null, error: string, detail?: string) => {
  if (!context) {
    return;
  }

  try {
    publishUploadProgress(context, {
      status: "failure",
      stage: "failed",
      error,
      detail: detail ?? error,
    });
  } catch {
    // Best-effort only. The HTTP error response still carries the failure.
  }
};

const encodeSseEvent = (encoder: TextEncoder, eventName: string, payload: unknown, revision?: number) => {
  const lines: string[] = [];
  if (revision != null) {
    lines.push(`id: ${revision}`);
  }
  lines.push(`event: ${eventName}`);
  lines.push(`data: ${JSON.stringify(payload)}`);
  return encoder.encode(`${lines.join("\n")}\n\n`);
};

export async function GET_EVENTS(request: Request) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("userId")?.trim();

  if (!userId) {
    return json({ status: "failure", error: "userId is required." }, 400);
  }

  try {
    assertDummyUserExists(userId);
    const requestedUploadId = parseUploadId(searchParams.get("uploadId"));
    const encoder = new TextEncoder();
    let closeStream = () => {};

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let unsubscribe = () => {};
        let heartbeat: ReturnType<typeof setInterval> | null = null;
        let closed = false;

        const close = () => {
          if (closed) {
            return;
          }

          closed = true;
          if (heartbeat) {
            clearInterval(heartbeat);
            heartbeat = null;
          }
          unsubscribe();
          request.signal.removeEventListener("abort", close);

          try {
            controller.close();
          } catch {
            // Ignore close races when the stream is already closed.
          }
        };

        closeStream = close;

        const write = (eventName: string, payload: unknown, revision?: number) => {
          if (closed) {
            return;
          }

          try {
            controller.enqueue(encodeSseEvent(encoder, eventName, payload, revision));
          } catch {
            close();
          }
        };

        try {
          controller.enqueue(encoder.encode("retry: 2000\n\n"));

          const subscription = subscribeToUploadProgress(
            {
              userId,
              uploadId: requestedUploadId,
              allowCompleted: true,
            },
            (snapshot, eventName) => {
              write(eventName, snapshot, snapshot.revision);
              if (isTerminalUploadStatus(snapshot.status)) {
                close();
              }
            },
          );

          unsubscribe = subscription.unsubscribe;
          write("session", subscription.snapshot, subscription.snapshot.revision);

          if (isTerminalUploadStatus(subscription.snapshot.status)) {
            close();
            return;
          }

          heartbeat = setInterval(() => {
            if (closed) {
              return;
            }

            try {
              controller.enqueue(encoder.encode(`: keep-alive ${Date.now()}\n\n`));
            } catch {
              close();
            }
          }, 15000);

          request.signal.addEventListener("abort", close, { once: true });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to open upload event stream.";
          write("failed", { status: "failure", error: message });
          close();
        }
      },
      cancel() {
        closeStream();
      },
    });

    return new Response(stream, { headers: sseHeaders });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to open upload event stream.";
    return json({ status: "failure", error: message }, 400);
  }
}

export async function GET_RAW(request: Request) {
  try {
    const dataset = requireOwnedDatasetFromSearch(request);
    const { searchParams } = new URL(request.url);
    const requestedSheet = searchParams.get("sheet")?.trim() ?? "";
    const limit = Math.max(1, Math.min(Number(searchParams.get("limit") ?? 50) || 50, 200));
    const offset = Math.max(0, Number(searchParams.get("offset") ?? 0) || 0);

    if (!existsSync(dataset.dbPath)) {
      return json({ status: "failure", error: "Dataset database not found." }, 404);
    }

    const db = new DatabaseSync(dataset.dbPath, { readOnly: true });
    try {
      const sheets = all(
        db,
        `
        SELECT sheetName, COUNT(*) AS rows
        FROM "RawSheetRow"
        GROUP BY sheetName
        ORDER BY MIN(id)
        `,
      ).map((row) => ({
        sheetName: String(row.sheetName ?? ""),
        rows: Number(row.rows ?? 0),
      }));
      const selectedSheetName =
        sheets.find((sheet) => sheet.sheetName === requestedSheet)?.sheetName ?? sheets[0]?.sheetName ?? "";
      const rows = selectedSheetName
        ? all(
            db,
            `
            SELECT sourceRowNumber, naturalKey, payloadJson
            FROM "RawSheetRow"
            WHERE sheetName = ?
            ORDER BY sourceRowNumber ASC
            LIMIT ? OFFSET ?
            `,
            [selectedSheetName, limit, offset],
          ).map((row) => {
            let payload: Record<string, unknown> = {};
            try {
              payload = JSON.parse(String(row.payloadJson ?? "{}")) as Record<string, unknown>;
            } catch {
              payload = {};
            }

            return {
              sourceRowNumber: Number(row.sourceRowNumber ?? 0),
              naturalKey: String(row.naturalKey ?? ""),
              payload,
            };
          })
        : [];

      return json({
        status: "success",
        dataset: toClientDatasetRecord(dataset),
        sheets,
        selectedSheetName,
        limit,
        offset,
        rows,
      });
    } finally {
      db.close();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load raw workbook rows.";
    return json({ status: "failure", error: message }, 400);
  }
}

export async function GET_DOWNLOAD(request: Request) {
  try {
    const dataset = requireOwnedDatasetFromSearch(request);
    if (!existsSync(dataset.excelPath)) {
      return json({ status: "failure", error: "Workbook file not found." }, 404);
    }

    const filename = safeDownloadFileName(dataset.originalFileName || dataset.excelFileName);
    const bytes = readFileSync(dataset.excelPath);
    return new Response(bytes, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename.replace(/"/g, "'")}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to download workbook.";
    return json({ status: "failure", error: message }, 400);
  }
}

export async function GET_SCHEMA_VALIDATION(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const datasetId = searchParams.get("datasetId")?.trim();
    const userId = searchParams.get("userId")?.trim();

    if (!userId || !datasetId) {
      return json({ status: "failure", error: "userId and datasetId are required." }, 400);
    }

    assertDummyUserExists(userId);
    const result = readDatasetSchemaValidation(datasetId, userId);
    return json({ status: "success", ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load dataset schema validation.";
    return json({ status: "failure", error: message }, 400);
  }
}

export async function POST_SCHEMA_VALIDATION(request: Request) {
  try {
    const body = (await request.json()) as Partial<WorkforceSchemaValidationInput>;
    const datasetId = body.datasetId?.trim();
    const userId = body.userId?.trim();

    if (!datasetId || !userId) {
      return json({ status: "failure", error: "userId and datasetId are required." }, 400);
    }

    assertDummyUserExists(userId);
    const result = validateDatasetSchema({
      datasetId,
      userId,
      tables: Array.isArray(body.tables) ? body.tables : [],
    });
    return json({ status: "success", ...result });
  } catch (error) {
    const status = error instanceof SchemaValidationAlreadyCompletedError ? 409 : 400;
    const message = error instanceof Error ? error.message : "Failed to validate dataset schema.";
    return json({ status: "failure", error: message }, status);
  }
}

export async function POST(request: Request) {
  let uploadContext: UploadContext | null = null;

  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("multipart/form-data")) {
      return json(
        {
          error: "Expected multipart/form-data with a file field named file, excel, or workbook.",
        },
        400,
      );
    }

    const formData = await request.formData();
    const file = getUploadFile(formData);
    uploadContext = getUploadContext(request, formData);

    publishUploadProgress(uploadContext, {
      status: "processing",
      stage: "reading_workbook",
      stepIndex: 0,
      progress: 10,
      message: WORKFORCE_UPLOAD_STEP_LABELS[0],
      detail: `Upload received for ${file.name}. Preparing the dataset workspace.`,
    });
    await yieldToEventLoop();

    const dataset = await createDatasetFromUpload(file, {
      userId: uploadContext.userId,
      label: getTextField(formData.get("label") ?? formData.get("datasetLabel")),
      conversationId: getTextField(formData.get("conversationId")),
      onProgress: async (update) => {
        publishUploadProgress(uploadContext!, update);
        await yieldToEventLoop();
      },
    });

    publishUploadProgress(uploadContext, {
      status: "processing",
      stage: "verifying_import",
      stepIndex: 2,
      progress: 95,
      message: WORKFORCE_UPLOAD_STEP_LABELS[2],
      detail: "Running post-import verification checks.",
      datasetId: dataset.datasetId,
    });
    await yieldToEventLoop();

    const verification = verifyImportedDatabase({
      excelPath: dataset.excelPath,
      dbPath: dataset.dbPath,
    });

    if (verification.failed > 0) {
      try {
        deleteDatasetRecord(dataset.datasetId);
      } catch {
        // Preserve the main verification failure; cleanup is best-effort here.
      }

      publishUploadProgress(uploadContext, {
        status: "failure",
        stage: "failed",
        datasetId: dataset.datasetId,
        error: "Workbook import verification failed.",
        detail: `${verification.failed} verification checks failed after import.`,
        verification: {
          passed: verification.passed,
          failed: verification.failed,
        },
      });

      return json(
        {
          status: "failure",
          error: "Workbook import verification failed.",
          uploadId: uploadContext.uploadId,
          datasetId: dataset.datasetId,
          verification: {
            passed: verification.passed,
            failed: verification.failed,
            failures: verification.results.filter((result) => !result.passed),
          },
        },
        422,
      );
    }

    const finalizedDataset = ensureDatasetStaticDashboard(dataset, "upload").record;

    publishUploadProgress(uploadContext, {
      status: "success",
      stage: "complete",
      stepIndex: 3,
      progress: 100,
      message: WORKFORCE_UPLOAD_STEP_LABELS[3],
      detail: "Workbook import, verification, and static dashboard snapshot generation completed successfully.",
      datasetId: finalizedDataset.datasetId,
      verification: {
        passed: verification.passed,
        failed: verification.failed,
      },
    });
    await yieldToEventLoop();

    return json(
      {
        status: "success",
        uploadId: uploadContext.uploadId,
        dataset: toClientDatasetRecord(finalizedDataset),
        mastraInput: {
          datasetId: finalizedDataset.datasetId,
        },
        verification: {
          passed: verification.passed,
          failed: verification.failed,
        },
      },
      201,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to import workbook.";
    tryPublishFailure(uploadContext, message);
    return json({ status: "failure", error: message, uploadId: uploadContext?.uploadId ?? null }, 400);
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const datasetId = searchParams.get("datasetId")?.trim();
  const userId = searchParams.get("userId")?.trim();

  if (!userId) {
    return json({ status: "failure", error: "userId is required." }, 400);
  }

  try {
    assertDummyUserExists(userId);

    if (!datasetId) {
      return json({
        status: "success",
        userId,
        datasets: listDatasetRecordsForUser(userId).map(toClientDatasetRecord),
      });
    }

    const dataset = assertDatasetOwnedByUser(datasetId, userId);
    return json({
      status: "success",
      dataset: toClientDatasetRecord(dataset),
      mastraInput: {
        datasetId,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Dataset not found.";
    return json({ status: "failure", error: message }, 404);
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as { datasetId?: string; conversationId?: string; userId?: string };
    const datasetId = body.datasetId?.trim();
    const conversationId = body.conversationId?.trim();
    const userId = body.userId?.trim();

    if (!datasetId || !conversationId || !userId) {
      return json({ status: "failure", error: "datasetId, conversationId, and userId are required." }, 400);
    }

    assertDummyUserExists(userId);
    assertDatasetOwnedByUser(datasetId, userId);
    const dataset = attachConversationToDataset(datasetId, conversationId);
    return json({
      status: "success",
      dataset: toClientDatasetRecord(dataset),
      mastraInput: {
        datasetId: dataset.datasetId,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update dataset.";
    return json({ status: "failure", error: message }, 400);
  }
}
