import { getCloudflareRuntime, type D1DatabaseLike } from "./runtime";
import {
  appendCloudWorkforceConversationMessage,
  assertCloudDatasetOwnedByUser,
  attachCloudConversationToDataset,
  createCloudDatasetFromUpload,
  deleteCloudWorkforceConversation,
  encodeBytesForResponse,
  getCloudDummyUserById,
  getOrCreateCloudWorkforceConversation,
  listCloudDatasetRecordsForUser,
  listCloudWorkforceConversations,
  listCloudWorkforceConversationsForUser,
  loginCloudDummyUser,
  readCloudDatasetRecord,
  readCloudDatasetSchemaValidation,
  readCloudRawWorkbookRows,
  readCloudWorkbookBytes,
  readCloudWorkforceConversation,
  roles,
  toClientDatasetRecord,
  updateCloudDummyUserRole,
  updateCloudWorkforceConversationMemory,
  validateCloudDatasetSchema,
  type CloudDatasetRecord,
  type WorkforceDashboardSection,
  type WorkforceStaticDashboardSnapshot,
} from "./storage";
import {
  SchemaValidationAlreadyCompletedError,
  normalizeSchemaValidationState,
  type WorkforceSchemaValidationTableAlias,
} from "../lib/workforce-schema-validation-types";
import {
  getUploadProgressSession,
  isTerminalUploadStatus,
  parseUploadId,
  publishUploadProgress,
  subscribeToUploadProgress,
  WORKFORCE_UPLOAD_STEP_LABELS,
} from "../lib/workforce-upload-progress";

type RouteHandler = (request: Request, path?: string[]) => Promise<Response>;

type UploadContext = {
  uploadId: string;
  userId: string;
};

type DetailCard = {
  label: string;
  value: string;
  detail?: string;
};

type DetailChart = {
  type: "bar";
  title: string;
  data: Array<{ label: string; value: number; color?: string }>;
};

type DetailTable = {
  title: string;
  headers: string[];
  rows: string[][];
};

type WorkspaceChatDetails = {
  view: "overview" | "staffing-fit" | "supply-risk" | "skill-gaps" | "demand" | "table-query";
  title: string;
  summary: string;
  cards: DetailCard[];
  charts: DetailChart[];
  tables: DetailTable[];
  json: Record<string, unknown>;
};

class HttpError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

const json = (body: unknown, status = 200) => Response.json(body, { status });

const sseHeaders = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
} as const;

const text = (value: unknown) => String(value ?? "").trim();
const number = (value: unknown) => Number(value ?? 0) || 0;
const formatNumber = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1));

const isPiiRequest = (message: string) => {
  const normalized = text(message).toLowerCase();
  const asksForData = /\b(show|list|give|get|find|display|query|lookup|what|which|who|export|download|provide|tell)\b/.test(normalized);
  const directIdentifier =
    /\b(pii|personal identifiers?|personal identification|ssn|social security(?: number)?|passport(?: number)?|driver'?s? licen[cs]e(?: number)?|license number|biometric(?: data)?|fingerprint|faceprint|retina|iris scan|aadhaar|national id|tax id|employee id|person id)\b/.test(
      normalized,
    );
  const indirectIdentifier =
    /\b(full legal names?|legal names?|full names?|date of birth|birth date|dob|phone numbers?|mobile numbers?|contact numbers?|telephone numbers?|personal emails?|email addresses?)\b/.test(
      normalized,
    );
  const addressIdentifier =
    /\b(home|mailing|residential|street|postal)\s+address(?:es)?\b/.test(normalized) ||
    (asksForData && /\b(address|addresses)\b/.test(normalized));

  return directIdentifier || indirectIdentifier || addressIdentifier;
};

const privacyBlockedRoute = () => ({
  intent: "privacy_restricted",
  confidence: "High",
  reason: "The question asks for direct or indirect personal identifiers.",
  executionMode: "blocked",
  plannedAgentPath: [],
  executionPlan: [],
  skippedAgents: ["Cloudflare D1 Snapshot Tool", "Generic DB Query Tool"],
});
const records = (value: unknown) => (Array.isArray(value) ? (value as Array<Record<string, unknown>>) : []);
const record = (value: unknown) => (value && typeof value === "object" ? (value as Record<string, unknown>) : {});
const waitForTurn = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const requireRuntime = async () => {
  const runtime = await getCloudflareRuntime();
  if (!runtime) {
    throw new HttpError(500, "Cloudflare D1/R2 bindings are not available.");
  }
  return runtime.env;
};

const getTextField = (value: FormDataEntryValue | null) => (typeof value === "string" ? text(value) || null : null);

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

const getUploadContext = async (request: Request, formData: FormData): Promise<UploadContext> => {
  const { DB } = await requireRuntime();
  const userId = requireText(getTextField(formData.get("userId")), "userId");
  if (!(await getCloudDummyUserById(DB, userId))) {
    throw new Error(`User not found: ${userId}`);
  }
  const session = getUploadProgressSession({
    userId,
    uploadId: getRequestedUploadId(request, formData),
  });
  return { uploadId: session.uploadId, userId };
};

const tryPublishFailure = (context: UploadContext | null, error: string, detail?: string) => {
  if (!context) return;
  try {
    publishUploadProgress(context, {
      status: "failure",
      stage: "failed",
      error,
      detail: detail ?? error,
    });
  } catch {
    // Best effort only.
  }
};

const encodeSseEvent = (encoder: TextEncoder, eventName: string, payload: unknown, revision?: number) => {
  const lines: string[] = [];
  if (revision != null) lines.push(`id: ${revision}`);
  lines.push(`event: ${eventName}`);
  lines.push(`data: ${JSON.stringify(payload)}`);
  return encoder.encode(`${lines.join("\n")}\n\n`);
};

const safeDownloadFileName = (value: string) =>
  (value || "workforce-workbook.xlsx")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim() || "workforce-workbook.xlsx";

const requireOwnedDatasetFromSearch = async (request: Request) => {
  const { DB } = await requireRuntime();
  const { searchParams } = new URL(request.url);
  const datasetId = text(searchParams.get("datasetId"));
  const userId = text(searchParams.get("userId"));
  if (!userId || !datasetId) {
    throw new HttpError(400, "userId and datasetId are required.");
  }
  if (!(await getCloudDummyUserById(DB, userId))) {
    throw new HttpError(404, "Dataset not found.");
  }
  try {
    return assertCloudDatasetOwnedByUser(DB, datasetId, userId);
  } catch (error) {
    throw new HttpError(404, error instanceof Error ? error.message : "Dataset not found.");
  }
};

const authLoginPOST: RouteHandler = async (request) => {
  const { DB } = await requireRuntime();
  try {
    const body = (await request.json()) as { username?: string; password?: string };
    const username = text(body.username);
    const password = text(body.password);
    if (!username || !password) {
      return json({ status: "failure", success: false, error: "username and password are required." }, 400);
    }
    const user = await loginCloudDummyUser(DB, username, password);
    if (!user) {
      return json({ status: "failure", success: false, error: "Invalid username or password." }, 401);
    }
    return json({
      status: "success",
      success: true,
      userId: user.userId,
      username: user.username,
      role: user.role,
      profileImage: user.profileImage,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Login failed.";
    return json({ status: "failure", success: false, error: message }, 400);
  }
};

const authRolesGET: RouteHandler = async (request) => {
  const { DB } = await requireRuntime();
  try {
    const { searchParams } = new URL(request.url);
    const userId = text(searchParams.get("userId"));
    if (!userId) {
      return json({ status: "success", roles: roles() });
    }
    const user = await getCloudDummyUserById(DB, userId);
    if (!user) {
      return json({ status: "failure", error: `User not found: ${userId}` }, 404);
    }
    return json({ status: "success", roles: roles(), user });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load roles.";
    return json({ status: "failure", error: message }, 400);
  }
};

const authRolesPOST: RouteHandler = async (request) => {
  const { DB } = await requireRuntime();
  try {
    const body = (await request.json()) as { userId?: string; role?: string };
    const userId = text(body.userId);
    const role = text(body.role);
    if (!userId || !role) {
      return json({ status: "failure", error: "userId and role are required." }, 400);
    }
    const user = await updateCloudDummyUserRole(DB, { userId, role });
    return json({ status: "success", user });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update role.";
    return json({ status: "failure", error: message }, 400);
  }
};

const workforceEventsGET: RouteHandler = async (request) => {
  const { DB } = await requireRuntime();
  const { searchParams } = new URL(request.url);
  const userId = text(searchParams.get("userId"));
  if (!userId) {
    return json({ status: "failure", error: "userId is required." }, 400);
  }
  try {
    if (!(await getCloudDummyUserById(DB, userId))) {
      throw new Error(`User not found: ${userId}`);
    }
    const requestedUploadId = parseUploadId(searchParams.get("uploadId"));
    const encoder = new TextEncoder();
    let closeStream = () => {};
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let unsubscribe = () => {};
        let heartbeat: ReturnType<typeof setInterval> | null = null;
        let closed = false;
        const close = () => {
          if (closed) return;
          closed = true;
          if (heartbeat) clearInterval(heartbeat);
          unsubscribe();
          request.signal.removeEventListener("abort", close);
          try {
            controller.close();
          } catch {
            // Ignore close races.
          }
        };
        closeStream = close;
        const write = (eventName: string, payload: unknown, revision?: number) => {
          if (closed) return;
          try {
            controller.enqueue(encodeSseEvent(encoder, eventName, payload, revision));
          } catch {
            close();
          }
        };
        try {
          controller.enqueue(encoder.encode("retry: 2000\n\n"));
          const subscription = subscribeToUploadProgress(
            { userId, uploadId: requestedUploadId, allowCompleted: true },
            (snapshot, eventName) => {
              write(eventName, snapshot, snapshot.revision);
              if (isTerminalUploadStatus(snapshot.status)) close();
            },
          );
          unsubscribe = subscription.unsubscribe;
          write("session", subscription.snapshot, subscription.snapshot.revision);
          if (isTerminalUploadStatus(subscription.snapshot.status)) {
            close();
            return;
          }
          heartbeat = setInterval(() => {
            if (!closed) controller.enqueue(encoder.encode(`: keep-alive ${Date.now()}\n\n`));
          }, 15000);
          request.signal.addEventListener("abort", close, { once: true });
        } catch (error) {
          write("failed", {
            status: "failure",
            error: error instanceof Error ? error.message : "Failed to open upload event stream.",
          });
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
};

const workforceRawGET: RouteHandler = async (request) => {
  const { DB } = await requireRuntime();
  try {
    const dataset = await requireOwnedDatasetFromSearch(request);
    const { searchParams } = new URL(request.url);
    const requestedSheet = text(searchParams.get("sheet"));
    const limit = Math.max(1, Math.min(Number(searchParams.get("limit") ?? 50) || 50, 200));
    const offset = Math.max(0, Number(searchParams.get("offset") ?? 0) || 0);
    const raw = await readCloudRawWorkbookRows(DB, dataset.datasetId, requestedSheet, limit, offset);
    return json({
      status: "success",
      dataset: toClientDatasetRecord(dataset),
      sheets: raw.sheets,
      selectedSheetName: raw.selectedSheetName,
      limit,
      offset,
      rows: raw.rows,
    });
  } catch (error) {
    const status = error instanceof HttpError ? error.statusCode : 400;
    const message = error instanceof Error ? error.message : "Failed to load raw workbook rows.";
    return json({ status: "failure", error: message }, status);
  }
};

const workforceDownloadGET: RouteHandler = async (request) => {
  const { WORKFORCE_UPLOADS } = await requireRuntime();
  try {
    const dataset = await requireOwnedDatasetFromSearch(request);
    const bytes = await readCloudWorkbookBytes(WORKFORCE_UPLOADS, dataset);
    if (!bytes) {
      return json({ status: "failure", error: "Workbook file not found." }, 404);
    }
    const filename = safeDownloadFileName(dataset.originalFileName || dataset.excelFileName);
    return new Response(encodeBytesForResponse(bytes), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename.replace(/"/g, "'")}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const status = error instanceof HttpError ? error.statusCode : 400;
    const message = error instanceof Error ? error.message : "Failed to download workbook.";
    return json({ status: "failure", error: message }, status);
  }
};

const workforceDatasetsPOST: RouteHandler = async (request) => {
  const { DB, WORKFORCE_UPLOADS } = await requireRuntime();
  let uploadContext: UploadContext | null = null;
  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("multipart/form-data")) {
      return json({ error: "Expected multipart/form-data with a file field named file, excel, or workbook." }, 400);
    }
    const formData = await request.formData();
    const file = getUploadFile(formData);
    uploadContext = await getUploadContext(request, formData);
    publishUploadProgress(uploadContext, {
      status: "processing",
      stage: "reading_workbook",
      stepIndex: 0,
      progress: 10,
      message: WORKFORCE_UPLOAD_STEP_LABELS[0],
      detail: `Upload received for ${file.name}. Preparing the Cloudflare dataset workspace.`,
    });
    await waitForTurn();
    const dataset = await createCloudDatasetFromUpload(DB, WORKFORCE_UPLOADS, file, {
      userId: uploadContext.userId,
      label: getTextField(formData.get("label") ?? formData.get("datasetLabel")),
      conversationId: getTextField(formData.get("conversationId")),
      onProgress: async (update) => {
        publishUploadProgress(uploadContext!, update);
        await waitForTurn();
      },
    });
    publishUploadProgress(uploadContext, {
      status: "success",
      stage: "complete",
      stepIndex: 3,
      progress: 100,
      message: WORKFORCE_UPLOAD_STEP_LABELS[3],
      detail: "Workbook import and static dashboard snapshot generation completed successfully.",
      datasetId: dataset.datasetId,
      verification: { passed: 0, failed: 0 },
    });
    await waitForTurn();
    return json(
      {
        status: "success",
        uploadId: uploadContext.uploadId,
        dataset: toClientDatasetRecord(dataset),
        mastraInput: { datasetId: dataset.datasetId },
        verification: { passed: 0, failed: 0 },
      },
      201,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to import workbook.";
    tryPublishFailure(uploadContext, message);
    return json({ status: "failure", error: message, uploadId: uploadContext?.uploadId ?? null }, 400);
  }
};

const workforceDatasetsGET: RouteHandler = async (request) => {
  const { DB } = await requireRuntime();
  const { searchParams } = new URL(request.url);
  const datasetId = text(searchParams.get("datasetId"));
  const userId = text(searchParams.get("userId"));
  if (!userId) {
    return json({ status: "failure", error: "userId is required." }, 400);
  }
  try {
    if (!(await getCloudDummyUserById(DB, userId))) {
      throw new Error(`User not found: ${userId}`);
    }
    if (!datasetId) {
      const datasets = await listCloudDatasetRecordsForUser(DB, userId);
      return json({ status: "success", userId, datasets: datasets.map(toClientDatasetRecord) });
    }
    const dataset = await assertCloudDatasetOwnedByUser(DB, datasetId, userId);
    return json({
      status: "success",
      dataset: toClientDatasetRecord(dataset),
      mastraInput: { datasetId: dataset.datasetId },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Dataset not found.";
    return json({ status: "failure", error: message }, 404);
  }
};

const workforceDatasetsPATCH: RouteHandler = async (request) => {
  const { DB } = await requireRuntime();
  try {
    const body = (await request.json()) as { datasetId?: string; conversationId?: string; userId?: string };
    const datasetId = text(body.datasetId);
    const conversationId = text(body.conversationId);
    const userId = text(body.userId);
    if (!datasetId || !conversationId || !userId) {
      return json({ status: "failure", error: "datasetId, conversationId, and userId are required." }, 400);
    }
    if (!(await getCloudDummyUserById(DB, userId))) {
      throw new Error(`User not found: ${userId}`);
    }
    await assertCloudDatasetOwnedByUser(DB, datasetId, userId);
    const dataset = await attachCloudConversationToDataset(DB, datasetId, conversationId);
    return json({ status: "success", dataset: toClientDatasetRecord(dataset), mastraInput: { datasetId } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update dataset.";
    return json({ status: "failure", error: message }, 400);
  }
};

const workforceSchemaValidationGET: RouteHandler = async (request) => {
  const { DB } = await requireRuntime();
  const { searchParams } = new URL(request.url);
  const datasetId = text(searchParams.get("datasetId"));
  const userId = text(searchParams.get("userId"));
  if (!userId || !datasetId) {
    return json({ status: "failure", error: "userId and datasetId are required." }, 400);
  }
  try {
    if (!(await getCloudDummyUserById(DB, userId))) {
      throw new Error(`User not found: ${userId}`);
    }
    const result = await readCloudDatasetSchemaValidation(DB, datasetId, userId);
    return json({ status: "success", ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load dataset schema validation.";
    return json({ status: "failure", error: message }, 400);
  }
};

const workforceSchemaValidationPOST: RouteHandler = async (request) => {
  const { DB } = await requireRuntime();
  try {
    const body = (await request.json()) as {
      datasetId?: string;
      userId?: string;
      tables?: WorkforceSchemaValidationTableAlias[];
    };
    const datasetId = text(body.datasetId);
    const userId = text(body.userId);
    if (!datasetId || !userId) {
      return json({ status: "failure", error: "userId and datasetId are required." }, 400);
    }
    if (!(await getCloudDummyUserById(DB, userId))) {
      throw new Error(`User not found: ${userId}`);
    }
    const result = await validateCloudDatasetSchema(DB, {
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
};

const sectionFromPath = (pathSegments: string[]): WorkforceDashboardSection | null => {
  if (pathSegments.length === 0) return null;
  if (pathSegments.length > 1) throw new HttpError(404, "API route not found.");
  switch (pathSegments[0]) {
    case "summary":
      return "summary";
    case "supply":
      return "supply";
    case "demand":
      return "demand";
    case "staffing-fit":
      return "staffingFit";
    case "skills":
      return "skills";
    case "ewa":
      return "ewa";
    default:
      throw new HttpError(404, "API route not found.");
  }
};

const isSkillGapsPath = (pathSegments: string[]) =>
  pathSegments.length === 2 && pathSegments[0] === "skills" && pathSegments[1] === "gaps";

const requireDashboardSnapshot = async (request: Request) => {
  const dataset = await requireOwnedDatasetFromSearch(request);
  const snapshot = dataset.staticDashboard;
  if (!snapshot?.sections) {
    throw new HttpError(404, "Dataset dashboard snapshot not found.");
  }
  return snapshot;
};

const workforceDashboardGET: RouteHandler = async (request, path = []) => {
  try {
    const snapshot = await requireDashboardSnapshot(request);
    if (isSkillGapsPath(path)) {
      return json({ status: "success", skillGaps: snapshot.sections.skills.skillGaps });
    }
    const section = sectionFromPath(path);
    if (!section) {
      return json({ status: "success", ...snapshot.sections });
    }
    return json({ status: "success", ...snapshot.sections[section] });
  } catch (error) {
    if (error instanceof HttpError) return json({ status: "failure", error: error.message }, error.statusCode);
    return json({ status: "failure", error: "Failed to build dashboard data." }, 500);
  }
};

const requireUser = async (request: Request) => {
  const { DB } = await requireRuntime();
  const { searchParams } = new URL(request.url);
  const userId = text(searchParams.get("userId"));
  if (!userId) throw new HttpError(400, "userId is required.");
  if (!(await getCloudDummyUserById(DB, userId))) throw new HttpError(404, "User not found.");
  return userId;
};

const requireUserAndDataset = async (request: Request) => {
  const { DB } = await requireRuntime();
  const { searchParams } = new URL(request.url);
  const userId = text(searchParams.get("userId"));
  const datasetId = text(searchParams.get("datasetId"));
  if (!userId || !datasetId) throw new HttpError(400, "userId and datasetId are required.");
  if (!(await getCloudDummyUserById(DB, userId))) throw new HttpError(404, "Dataset not found.");
  return { userId, datasetId };
};

const workforceConversationsGET: RouteHandler = async (request, path = []) => {
  const { DB } = await requireRuntime();
  try {
    const { userId, datasetId } = await requireUserAndDataset(request);
    const conversationId = text(path[0]);
    if (!conversationId) {
      return json({ status: "success", conversations: await listCloudWorkforceConversations(DB, { userId, datasetId }) });
    }
    return json({
      status: "success",
      conversation: await readCloudWorkforceConversation(DB, { conversationId, userId, datasetId }),
    });
  } catch (error) {
    if (error instanceof HttpError) return json({ status: "failure", error: error.message }, error.statusCode);
    const message = error instanceof Error ? error.message : "Failed to load conversations.";
    return json({ status: "failure", error: message }, 400);
  }
};

const workforceChatsGET: RouteHandler = async (request, path = []) => {
  const { DB } = await requireRuntime();
  try {
    const userId = await requireUser(request);
    const conversationId = text(path[0]);
    if (!conversationId) {
      return json({ status: "success", conversations: await listCloudWorkforceConversationsForUser(DB, { userId }) });
    }
    return json({ status: "success", conversation: await readCloudWorkforceConversation(DB, { conversationId, userId }) });
  } catch (error) {
    if (error instanceof HttpError) return json({ status: "failure", error: error.message }, error.statusCode);
    const message = error instanceof Error ? error.message : "Failed to load chats.";
    return json({ status: "failure", error: message }, 400);
  }
};

const workforceChatsDELETE: RouteHandler = async (request, path = []) => {
  const { DB, WORKFORCE_UPLOADS } = await requireRuntime();
  try {
    const userId = await requireUser(request);
    const conversationId = text(path[0]);
    if (!conversationId) return json({ status: "failure", error: "conversationId is required." }, 400);
    return json({
      status: "success",
      deletion: await deleteCloudWorkforceConversation(DB, WORKFORCE_UPLOADS, { conversationId, userId }),
    });
  } catch (error) {
    if (error instanceof HttpError) return json({ status: "failure", error: error.message }, error.statusCode);
    const message = error instanceof Error ? error.message : "Failed to delete chat.";
    return json({ status: "failure", error: message }, 400);
  }
};

const chooseDetailView = (message: string): WorkspaceChatDetails["view"] => {
  const normalized = message.toLowerCase();
  if (/(skill gap|skills? gaps?|capabilit|accessibility|blueprint|interview)/.test(normalized)) return "skill-gaps";
  if (/(bench|supply|available|availability|capacity|people|candidate|partial capacity|ewa|approval|blocker)/.test(normalized)) return "supply-risk";
  if (/(demand|pipeline|opportunit|role|fte|delivery risk|priority|required|start dates?)/.test(normalized)) return "demand";
  return "staffing-fit";
};

const bar = (title: string, data: Array<{ label: string; value: number; color?: string }>): DetailChart => ({
  type: "bar",
  title,
  data,
});

const uniqueText = (values: string[]) => [...new Set(values.map((value) => text(value)).filter(Boolean))];

const lookupTokens = (value: string) =>
  uniqueText(
    value
      .toLowerCase()
      .split(/[^a-z0-9+#]+/g)
      .filter((token) => token.length >= 3),
  );

const containsLookupSignal = (message: string, signal: string) => {
  const normalizedMessage = ` ${message.toLowerCase()} `;
  const normalizedSignal = signal.toLowerCase();
  if (!normalizedSignal.trim()) return false;
  const messageTokens = new Set(lookupTokens(normalizedMessage));
  const escaped = normalizedSignal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (
    new RegExp(`(^|[^a-z0-9+#])${escaped}([^a-z0-9+#]|$)`).test(normalizedMessage) ||
    lookupTokens(normalizedSignal).some((token) => messageTokens.has(token))
  );
};

const isPeopleSkillLookupQuestion = (message: string) => {
  const asksForRowsOrCount = /\b(list|show|give|find|who|which|count|how many|number of|people|persons|employees?|resources?)\b/i.test(message);
  const asksForSkillEvidence = /\b(skill|skills|skilled|knows?|experience|experienced)\b/i.test(message);
  const asksPeopleWithValue =
    /\b(people|persons|employees?|resources?)\b/i.test(message) && /\bwith\b/i.test(message);
  return asksForRowsOrCount && (asksForSkillEvidence || asksPeopleWithValue);
};

const cloudPeopleSkillDetails = async (
  db: D1DatabaseLike,
  dataset: CloudDatasetRecord,
  message: string,
): Promise<WorkspaceChatDetails | null> => {
  const [skillRows, peopleRows] = await Promise.all([
    readCloudRawWorkbookRows(db, dataset.datasetId, "Skills", 5000, 0),
    readCloudRawWorkbookRows(db, dataset.datasetId, "People", 5000, 0),
  ]);
  const skillPayloads = skillRows.rows.map((row) => row.payload);
  const skillNames = uniqueText(skillPayloads.map((row) => text(row.SkillName)));
  const requestedSkills = skillNames.filter((skillName) => containsLookupSignal(message, skillName));
  if (!requestedSkills.length) return null;
  const excluded = new Set(CLOUD_QUERY_STOP_WORDS);
  for (const skillName of requestedSkills) {
    for (const token of queryTokens(skillName)) {
      excluded.add(token);
      if (token.startsWith(".")) excluded.add(token.slice(1));
    }
  }
  const personFilters = uniqueText(queryTokens(message).filter((token) => !excluded.has(token)));

  const peopleById = new Map(
    peopleRows.rows.map((row) => [text(row.payload.Employee_ID), row.payload]),
  );
  const matches = skillPayloads
    .filter((row) => requestedSkills.some((skillName) => text(row.SkillName).toLowerCase() === skillName.toLowerCase()))
    .map((row) => {
      const person = peopleById.get(text(row.Employee_ID)) ?? {};
      return {
        employeeId: text(row.Employee_ID),
        name: text(person.Employee_Name) || text(row.Employee_ID),
        discipline: text(person.Discipline),
        grade: text(person.Grade),
        city: text(person.City),
        country: text(person.Country),
        region: text(person.Region),
        department: text(person.Department),
        skillName: text(row.SkillName),
        skillLevel: number(row.SkillLevel),
        yearsExperience: number(row.YearsExperience),
        confidence: text(row.Confidence),
      };
    })
    .filter((row) => {
      if (!personFilters.length) return true;
      const haystack = [
        row.name,
        row.employeeId,
        row.discipline,
        row.grade,
        row.city,
        row.country,
        row.region,
        row.department,
      ].map((value) => normalizeQueryText(value));
      return personFilters.every((term) => haystack.some((value) => value.includes(term)));
    })
    .sort((left, right) => right.skillLevel - left.skillLevel || right.yearsExperience - left.yearsExperience || left.name.localeCompare(right.name));
  const uniquePeople = new Set(matches.map((match) => match.employeeId));
  const skillLabel = requestedSkills.join(", ");
  const personFilterLabel = personFilters.join(", ");

  return {
    view: "supply-risk",
    title: "People Skill Evidence",
    summary: `Found ${uniquePeople.size} people with ${skillLabel} evidence${personFilterLabel ? ` matching ${personFilterLabel}` : ""} in the uploaded dataset.`,
    cards: [
      { label: "People", value: formatNumber(uniquePeople.size), detail: skillLabel },
      { label: "Rows", value: formatNumber(matches.length), detail: "skill evidence" },
      { label: "Source", value: "Skills", detail: "raw workbook rows" },
      { label: "People Sheet", value: formatNumber(peopleRows.rows.length), detail: "identity rows loaded" },
    ],
    charts: [
      bar(
        "Top Skill Levels",
        matches.slice(0, 10).map((row) => ({ label: row.name, value: row.skillLevel, color: "#5899c4" })),
      ),
    ],
    tables: [
      {
        title: "People With Skill Evidence",
        headers: ["Person", "Employee ID", "Discipline", "Grade", "City", "Country", "Skill", "Level", "Years"],
        rows: matches.slice(0, 25).map((row) => [
          row.name,
          row.employeeId,
          row.discipline,
          row.grade,
          row.city,
          row.country,
          row.skillName,
          formatNumber(row.skillLevel),
          formatNumber(row.yearsExperience),
        ]),
      },
    ],
    json: {
      requestedSkills,
      personFilters,
      matches,
    },
  };
};

const CLOUD_QUERY_STOP_WORDS = new Set([
  "all",
  "also",
  "and",
  "any",
  "are",
  "both",
  "by",
  "count",
  "data",
  "dataset",
  "display",
  "employee",
  "employees",
  "experience",
  "experienced",
  "find",
  "for",
  "from",
  "give",
  "group",
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
  "per",
  "people",
  "person",
  "persons",
  "please",
  "query",
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
  "the",
  "total",
  "what",
  "where",
  "which",
  "who",
  "with",
]);

const CLOUD_SHEET_SYNONYMS: Record<string, string[]> = {
  People: ["people", "person", "employees", "employee", "resources", "resource"],
  Skills: ["skills", "skill", "skill evidence", "experience"],
  "Skill Catalog": ["skill catalog", "catalog", "skill definitions"],
  Profiles: ["profiles", "profile", "certifications", "languages"],
  Allocations: ["allocations", "allocation", "project", "projects", "client"],
  Bench: ["bench", "supply", "roll off", "rolloff"],
  "Partial Capacity": ["partial capacity", "capacity", "partial"],
  "Availability Calendar": ["availability", "availability calendar", "calendar"],
  "Bench Movement": ["bench movement", "movement", "trend"],
  "Project History": ["project history", "history", "past projects"],
  Opportunities: ["opportunities", "opportunity", "pipeline", "demand"],
  "Opportunity Roles": ["opportunity roles", "roles", "role", "required roles"],
  "Opportunity Overlays": ["overlays", "candidate overlays", "fit score"],
  "EWA Requests": ["ewa", "ewa requests", "approval", "approvals"],
  "Scenario Targets": ["scenario", "scenarios", "targets"],
};

const cloudSheetIntentBoost = (sheetName: string, message: string) => {
  const normalized = normalizeQueryText(message);
  const has = (pattern: RegExp) => pattern.test(normalized);

  if (sheetName === "Bench" && has(/\b(bench|supply|roll off|rolloff|available|availability|supply risk)\b/)) return 28;
  if (sheetName === "Partial Capacity" && has(/\b(partial capacity|partial|bench percent|bench fte)\b/)) return 30;
  if (sheetName === "Availability Calendar" && has(/\b(availability calendar|weekly availability|week|weeks|available fte|availability type)\b/)) return 26;
  if (sheetName === "Allocations" && has(/\b(allocation|allocations|current project|current role|planned end|client|project)\b/)) return 24;
  if (sheetName === "Project History" && has(/\b(project history|history|past project|past projects|technologies|methods|outcome)\b/)) return 28;
  if (sheetName === "Opportunities" && has(/\b(opportunity|opportunities|pipeline|stage|commercial priority|delivery risk|probability)\b/)) return 26;
  if (sheetName === "Opportunity Roles" && has(/\b(opportunity role|opportunity roles|roles|role demand|fte required|grade preference)\b/)) return 36;
  if (sheetName === "Opportunity Overlays" && has(/\b(overlay|candidate|candidates|fit status|fit score|match score|staffing score|rank)\b/)) return 28;
  if (sheetName === "EWA Requests" && has(/\b(ewa|approval|booking|blocker|blocking|pending approval|next action)\b/)) return 30;
  if (sheetName === "Scenario Targets" && has(/\b(scenario|target bench|bench target|success measure|target date)\b/)) return 26;
  if (sheetName === "Profiles" && has(/\b(profile|profiles|certification|certifications|languages|strengths|mobility)\b/)) return 24;

  return 0;
};

const normalizeQueryText = (value: unknown) =>
  text(value)
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9+#. ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const queryTokens = (value: unknown) =>
  normalizeQueryText(value)
    .split(" ")
    .filter((token) => token.length >= 2 || /\d/.test(token));

const isGenericDatasetQueryQuestion = (message: string) => {
  const hasQueryAction = /\b(list|show|give|display|count|how many|number of|which|what|find|lookup|query)\b/i.test(message);
  const hasDatasetEntity =
    /\b(people|persons|employees?|resources?|skills?|skilled|skill catalog|profiles?|allocations?|bench|availability|opportunities?|roles?|overlays?|ewa|requests?|scenarios?|targets?|projects?|history|records?|rows?|tables?|grade|discipline|country|city|domain|client|stage)\b/i.test(
      message,
    );
  const asksPlanningExecution =
    /\b(staff|staffing|team|recommend|recommendation|approval package|ready for approval|highest priority|build|capacity outlook|bench movement|near[-\s]?match|needed|required)\b/i.test(
      message,
    );
  const directDataRequest = /\b(list|show|give|display|count|how many|number of|find|lookup|query|records?|rows?|tables?)\b/i.test(message);
  return isPeopleSkillLookupQuestion(message) || (hasQueryAction && hasDatasetEntity && (!asksPlanningExecution || directDataRequest));
};

const cloudQueryType = (message: string) => {
  if (/\b(count|how many|number of|total)\b/i.test(message)) {
    return /\b(by|per|grouped by|breakdown by)\b/i.test(message) ? "group_count" : "count";
  }
  if (/\b(by|per|grouped by|breakdown by)\b/i.test(message)) return "group_count";
  return "list";
};

type CloudChatContextMessage = {
  role?: string;
  detailView?: string | null;
  details?: Record<string, unknown> | null;
};

const cloudGenericDatasetQueryContract = (details: Record<string, unknown> | null | undefined) => {
  const detailRecord = record(details);
  const jsonRecord = record(detailRecord.json);
  const explicit = record(jsonRecord.genericDatasetQuery);
  if (text(explicit.tableName) || text(explicit.queryType)) return explicit;
  if (text(jsonRecord.tableName) || text(jsonRecord.queryType)) return jsonRecord;
  return {};
};

const lastCloudGenericDatasetQueryContract = (messages: CloudChatContextMessage[]) => {
  for (const message of [...messages].reverse()) {
    if (message.role !== "assistant" || message.detailView !== "table-query") continue;
    const contract = cloudGenericDatasetQueryContract(message.details);
    if (Object.keys(contract).length) return contract;
  }
  return {};
};

const cloudGenericFilterTerms = (contract: Record<string, unknown>) => {
  const filters = contract.filters;
  if (!Array.isArray(filters)) return [];
  return filters
    .map((filter) => {
      if (filter && typeof filter === "object") return text((filter as Record<string, unknown>).term);
      return text(filter);
    })
    .filter(Boolean);
};

const isBareGenericCountFollowUp = (message: string) => {
  const normalized = text(message).toLowerCase().replace(/[?.!]+/g, "").replace(/\s+/g, " ").trim();
  return (
    /^(how many|count|total)$/.test(normalized) ||
    /^(how many|count|total) (are )?(there|them|these|those|people|persons|employees|resources|rows|records)$/.test(normalized) ||
    /^number of (them|these|those|people|persons|employees|resources|rows|records)$/.test(normalized)
  );
};

const isBareGenericListFollowUp = (message: string) => {
  const normalized = text(message).toLowerCase().replace(/[?.!]+/g, "").replace(/\s+/g, " ").trim();
  return /^(show|list|display|view|show them|show those|show records|show rows|list them|list those|view details)$/.test(normalized);
};

const contextualCloudGenericQueryMessage = (
  userMessage: string,
  previousMessages: CloudChatContextMessage[],
) => {
  const wantsCount = isBareGenericCountFollowUp(userMessage);
  const wantsList = isBareGenericListFollowUp(userMessage);
  if (!wantsCount && !wantsList) return userMessage;

  const contract = lastCloudGenericDatasetQueryContract(previousMessages);
  const tableName = text(contract.tableName);
  const tableDisplayName = text(contract.tableDisplayName) || tableName;
  if (!tableName && !tableDisplayName) return userMessage;

  const filterTerms = cloudGenericFilterTerms(contract);
  if (/Skills|PersonSkillEvidence/i.test(tableName) && filterTerms.length) {
    return wantsCount
      ? `how many people skilled in ${filterTerms.join(" and ")}`
      : `show people skilled in ${filterTerms.join(" and ")}`;
  }

  return `${wantsCount ? "count" : "show"} ${tableDisplayName || tableName}${filterTerms.length ? ` with ${filterTerms.join(" ")}` : ""}`;
};

const cloudSchemaAliasMapForRoute = (dataset: CloudDatasetRecord) => {
  const aliases = new Map<string, Map<string, string>>();
  const validation = normalizeSchemaValidationState(dataset.schemaValidation);
  for (const table of validation?.tables ?? []) {
    aliases.set(
      table.tableName,
      new Map(table.columns.map((column) => [column.columnName, column.displayName])),
    );
  }
  return aliases;
};

const cloudAliasFor = (dataset: CloudDatasetRecord, sheetName: string, columnName: string) =>
  cloudSchemaAliasMapForRoute(dataset).get(sheetName)?.get(columnName) ?? cloudColumnLabel(columnName);

const cloudSheetScore = (
  message: string,
  sheetName: string,
  columns: string[],
  sampleRows: Array<Record<string, unknown>>,
) => {
  const normalized = normalizeQueryText(message);
  let score = cloudSheetIntentBoost(sheetName, message);
  for (const signal of [sheetName, ...(CLOUD_SHEET_SYNONYMS[sheetName] ?? [])].flatMap(queryTokens)) {
    if (` ${normalized} `.includes(` ${signal} `)) score += 8;
  }
  for (const column of columns) {
    for (const signal of queryTokens(column)) {
      if (` ${normalized} `.includes(` ${signal} `)) score += 3;
    }
  }
  const terms = queryTokens(message).filter((token) => !CLOUD_QUERY_STOP_WORDS.has(token));
  for (const term of terms) {
    if (sampleRows.some((row) => Object.values(row).some((value) => normalizeQueryText(value).includes(term)))) {
      score += 4;
    }
  }
  return score;
};

const cloudSearchTerms = (message: string, sheetName: string, columns: string[], extraExclusions: string[] = []) => {
  const excluded = new Set(CLOUD_QUERY_STOP_WORDS);
  for (const token of [sheetName, ...(CLOUD_SHEET_SYNONYMS[sheetName] ?? [])].flatMap(queryTokens)) excluded.add(token);
  for (const column of columns) {
    for (const token of queryTokens(column)) excluded.add(token);
  }
  for (const value of extraExclusions) {
    for (const token of queryTokens(value)) excluded.add(token);
  }
  return uniqueText(queryTokens(message).filter((token) => !excluded.has(token)));
};

const cloudGroupColumn = (message: string, columns: string[]) => {
  const scoped = /\b(?:by|per|grouped by|breakdown by)\s+([a-z0-9_+#.\s-]{2,40})/i.exec(message)?.[1] ?? message;
  const normalized = normalizeQueryText(scoped);
  return columns
    .map((column) => ({
      column,
      score: queryTokens(column).filter((token) => ` ${normalized} `.includes(` ${token} `)).length,
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)[0]?.column ?? columns[0] ?? "";
};

const cloudDerivedTerms = (sheetName: string, message: string) => {
  const normalized = normalizeQueryText(message);
  const terms: string[] = [];

  if (sheetName === "Bench") {
    const futureRollOff = /\bfuture roll ?off\b/.test(normalized);
    const partialCapacity = /\bpartial capacity\b/.test(normalized);
    const currentBench =
      /\bcurrent bench\b/.test(normalized) ||
      (!futureRollOff && !partialCapacity && /\b(on bench|bench people|bench resources|people .*bench|resources .*bench)\b/.test(normalized));
    if (currentBench) terms.push("Current Bench");
    if (futureRollOff) terms.push("Future Roll-off");
    if (partialCapacity) terms.push("Partial Capacity");
  }
  if (sheetName === "EWA Requests" || sheetName === "Opportunity Overlays") {
    if (/\bpending approval\b/.test(normalized)) terms.push("Pending Approval");
    if (/\bblocked\b/.test(normalized)) terms.push("Blocked");
    if (/\bapproved\b/.test(normalized)) terms.push("Approved");
  }
  if (sheetName === "Opportunities") {
    if (/\bhigh priority\b/.test(normalized)) terms.push("High");
    if (/\bmedium priority\b/.test(normalized)) terms.push("Medium");
    if (/\blow priority\b/.test(normalized)) terms.push("Low");
  }

  return terms;
};

const cloudColumnLabel = (column: string) =>
  column
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();

const cloudRelationColumns = {
  people: ["Person_Name", "Person_City", "Person_Country", "Person_Region", "Person_Discipline", "Person_Grade", "Person_Department"],
  opportunity: ["Opportunity_Name", "Opportunity_Client", "Opportunity_Stage", "Opportunity_City", "Opportunity_Domain", "Opportunity_Priority", "Opportunity_Risk"],
  role: ["Role_Name", "Role_Discipline", "Role_Grade", "Role_Priority", "Role_Required_Skills", "Role_Desired_Skills"],
};

const cloudEnrichedRows = async (
  db: D1DatabaseLike,
  dataset: CloudDatasetRecord,
  sheetName: string,
  rows: Array<Record<string, unknown>>,
  columns: string[],
) => {
  const enrichPeople = ["Skills", "Profiles", "Allocations", "Bench", "Partial Capacity", "Availability Calendar", "Project History", "Opportunity Overlays", "EWA Requests"].includes(sheetName);
  const enrichOpportunity = ["Opportunity Roles", "Opportunity Overlays", "EWA Requests"].includes(sheetName);
  const enrichRole = ["Opportunity Overlays", "EWA Requests"].includes(sheetName);
  const preferredColumns: string[] = [];
  const extraColumns: string[] = [];
  const extraExclusions: string[] = [];

  let peopleById = new Map<string, Record<string, unknown>>();
  let opportunityById = new Map<string, Record<string, unknown>>();
  let roleById = new Map<string, Record<string, unknown>>();

  if (enrichPeople) {
    const peopleRows = await readCloudRawWorkbookRows(db, dataset.datasetId, "People", 5000, 0);
    peopleById = new Map(peopleRows.rows.map((row) => [text(row.payload.Employee_ID), row.payload]));
    preferredColumns.push("Person_Name", "Person_City", "Person_Discipline");
    extraColumns.push(...cloudRelationColumns.people);
    extraExclusions.push("people", "person", "employee", "employees", ...cloudRelationColumns.people);
  }
  if (enrichOpportunity) {
    const opportunityRows = await readCloudRawWorkbookRows(db, dataset.datasetId, "Opportunities", 5000, 0);
    opportunityById = new Map(opportunityRows.rows.map((row) => [text(row.payload.Opportunity_ID), row.payload]));
    preferredColumns.push("Opportunity_Name", "Opportunity_Client", "Opportunity_Stage");
    extraColumns.push(...cloudRelationColumns.opportunity);
    extraExclusions.push("opportunity", "opportunities", ...cloudRelationColumns.opportunity);
  }
  if (enrichRole) {
    const roleRows = await readCloudRawWorkbookRows(db, dataset.datasetId, "Opportunity Roles", 5000, 0);
    roleById = new Map(roleRows.rows.map((row) => [text(row.payload.Opportunity_Role_ID), row.payload]));
    preferredColumns.push("Role_Name", "Role_Priority");
    extraColumns.push(...cloudRelationColumns.role);
    extraExclusions.push("role", "roles", ...cloudRelationColumns.role);
  }

  const enriched = rows.map((row) => {
    const next = { ...row };
    if (enrichPeople) {
      const person = peopleById.get(text(row.Employee_ID)) ?? {};
      next.Person_Name = text(person.Employee_Name);
      next.Person_City = text(person.City);
      next.Person_Country = text(person.Country);
      next.Person_Region = text(person.Region);
      next.Person_Discipline = text(person.Discipline);
      next.Person_Grade = text(person.Grade);
      next.Person_Department = text(person.Department);
    }
    if (enrichOpportunity) {
      const opportunity = opportunityById.get(text(row.Opportunity_ID)) ?? {};
      next.Opportunity_Name = text(opportunity.Opportunity_Name);
      next.Opportunity_Client = text(opportunity.Client_Name);
      next.Opportunity_Stage = text(opportunity.Stage);
      next.Opportunity_City = text(opportunity.City);
      next.Opportunity_Domain = text(opportunity.Domain);
      next.Opportunity_Priority = text(opportunity.CommercialPriority);
      next.Opportunity_Risk = text(opportunity.DeliveryRisk);
    }
    if (enrichRole) {
      const role = roleById.get(text(row.Opportunity_Role_ID)) ?? {};
      next.Role_Name = text(role.RoleName);
      next.Role_Discipline = text(role.DisciplineOrDepartment);
      next.Role_Grade = text(role.GradePreference);
      next.Role_Priority = text(role.Priority);
      next.Role_Required_Skills = text(role.RequiredSkills);
      next.Role_Desired_Skills = text(role.DesiredSkills);
    }
    return next;
  });

  return {
    rows: enriched,
    columns: uniqueText([...extraColumns, ...columns]),
    preferredColumns: uniqueText(preferredColumns),
    extraExclusions,
    joined: enrichPeople || enrichOpportunity || enrichRole,
  };
};

const cloudGenericDatasetQueryDetails = async (
  db: D1DatabaseLike,
  dataset: CloudDatasetRecord,
  message: string,
): Promise<WorkspaceChatDetails | null> => {
  if (!isGenericDatasetQueryQuestion(message)) return null;

  const skillDetails = await cloudPeopleSkillDetails(db, dataset, message);
  if (skillDetails) {
    const type = cloudQueryType(message);
    const peopleCount = number(skillDetails.cards[0]?.value);
    const skillRows = skillDetails.tables[0]?.rows ?? [];
    const skillHeaders = skillDetails.tables[0]?.headers ?? [];
    const resultHeaders = type === "count" ? ["People"] : skillHeaders;
    const resultRows = type === "count" ? [[formatNumber(peopleCount)]] : skillRows;
    const skillFilters = Array.isArray(skillDetails.json.requestedSkills)
      ? skillDetails.json.requestedSkills.map((value) => text(value)).filter(Boolean)
      : [];
    const personFilters = Array.isArray(skillDetails.json.personFilters)
      ? skillDetails.json.personFilters.map((value) => text(value)).filter(Boolean)
      : [];
    return {
      ...skillDetails,
      view: "table-query",
      title: "Dataset Query Evidence",
      summary:
        type === "count"
          ? `Counted ${formatNumber(peopleCount)} people with ${text(skillDetails.cards[0]?.detail)} evidence${personFilters.length ? ` matching ${personFilters.join(", ")}` : ""} in the uploaded dataset.`
          : skillDetails.summary,
      cards: [
        { label: "Sheet", value: "Skills", detail: "joined to People" },
        { label: "Rows", value: formatNumber(type === "count" ? peopleCount : skillRows.length), detail: "returned" },
        { label: "Query Type", value: type === "count" ? "count" : "list", detail: "High" },
        { label: "Tool", value: "DB Query", detail: "read-only" },
      ],
      tables: [
        {
          title: type === "count" ? "Query Results" : "People With Skill Evidence",
          headers: resultHeaders,
          rows: resultRows,
        },
      ],
      json: {
        genericDatasetQuery: {
          query: message,
          queryType: type === "count" ? "count" : "list",
          tableName: "Skills",
          tableDisplayName: "Skills joined to People",
          confidence: "High",
          filters: [...skillFilters, ...personFilters],
          totalMatchingRows: type === "count" ? peopleCount : skillRows.length,
          returnedRows: resultRows.length,
          headers: resultHeaders,
          rows: resultRows,
        },
        evidence: [
          type === "count"
            ? "Generic DB Query Tool selected a read-only people-to-skill count."
            : "Generic DB Query Tool selected a read-only people-to-skill lookup.",
          "Read Skills and People raw workbook rows from D1 and joined them by Employee_ID.",
        ],
      },
    };
  }

  const first = await readCloudRawWorkbookRows(db, dataset.datasetId, "", 1, 0);
  const sheetSummaries = first.sheets;
  if (!sheetSummaries.length) return null;
  const sampled = await Promise.all(
    sheetSummaries.map(async (sheet) => {
      const raw = await readCloudRawWorkbookRows(db, dataset.datasetId, sheet.sheetName, 100, 0);
      const rows = raw.rows.map((row) => row.payload);
      const columns = uniqueText(rows.flatMap((row) => Object.keys(row)));
      return {
        sheetName: sheet.sheetName,
        totalRows: sheet.rows,
        rows,
        columns,
        score: cloudSheetScore(message, sheet.sheetName, columns, rows),
      };
    }),
  );
  const selected = sampled.sort((left, right) => right.score - left.score || right.totalRows - left.totalRows)[0];
  if (!selected) return null;

  const full = await readCloudRawWorkbookRows(db, dataset.datasetId, selected.sheetName, 5000, 0);
  const rawRows = full.rows.map((row) => row.payload);
  const rawColumns = uniqueText(rawRows.flatMap((row) => Object.keys(row)));
  const enriched = await cloudEnrichedRows(db, dataset, selected.sheetName, rawRows, rawColumns);
  const rows = enriched.rows;
  const columns = enriched.columns;
  const derivedTerms = cloudDerivedTerms(selected.sheetName, message);
  const derivedTokens = new Set(derivedTerms.flatMap(queryTokens));
  const terms = uniqueText([
    ...derivedTerms,
    ...cloudSearchTerms(message, selected.sheetName, columns, enriched.extraExclusions).filter(
      (term) => !derivedTokens.has(term),
    ),
  ]);
  const filteredRows = terms.length
    ? rows.filter((row) =>
        terms.every((term) => Object.values(row).some((value) => normalizeQueryText(value).includes(term))),
      )
    : rows;
  const type = cloudQueryType(message);
  const confidence = selected.score >= 12 ? "High" : selected.score >= 5 ? "Medium" : "Low";

  if (type === "count") {
    const headers = ["Count"];
    const tableRows = [[formatNumber(filteredRows.length)]];
    return {
      view: "table-query",
      title: "Dataset Query Evidence",
      summary: `Counted ${filteredRows.length} matching row(s) in ${selected.sheetName}.`,
      cards: [
        { label: "Sheet", value: selected.sheetName, detail: "raw workbook rows" },
        { label: "Rows", value: formatNumber(filteredRows.length), detail: `${rows.length} loaded` },
        { label: "Query Type", value: "count", detail: confidence },
        { label: "Filters", value: terms.length ? formatNumber(terms.length) : "0", detail: terms.join(", ") || "No filters" },
      ],
      charts: [],
      tables: [{ title: "Query Results", headers, rows: tableRows }],
      json: {
        router: chatRoute({
          view: "table-query",
          title: "Dataset Query Evidence",
          summary: "",
          cards: [],
          charts: [],
          tables: [],
          json: {},
        }),
        genericDatasetQuery: {
          query: message,
          queryType: "count",
          tableName: selected.sheetName,
          tableDisplayName: selected.sheetName,
          confidence,
          filters: terms,
          totalMatchingRows: filteredRows.length,
          returnedRows: 1,
          headers,
          rows: tableRows,
        },
        evidence: [
          `Generic DB Query Tool selected workbook sheet ${selected.sheetName}.`,
          enriched.joined ? "Joined related raw workbook rows so filters can match connected people, opportunities, and roles." : "No related-sheet join was needed for this lookup.",
          "Read raw workbook rows from D1 and applied deterministic filters in memory.",
        ],
      },
    };
  }

  if (type === "group_count") {
    const groupColumn = cloudGroupColumn(message, columns);
    const counts = new Map<string, number>();
    for (const row of filteredRows) {
      const key = text(row[groupColumn]) || "Blank";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const groupedRows = [...counts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 25);
    const displayGroupColumn = cloudAliasFor(dataset, selected.sheetName, groupColumn);
    const tableRows = groupedRows.map(([label, count]) => [label, formatNumber(count)]);
    return {
      view: "table-query",
      title: "Dataset Query Evidence",
      summary: `Grouped ${filteredRows.length} matching row(s) from ${selected.sheetName} by ${displayGroupColumn}.`,
      cards: [
        { label: "Sheet", value: selected.sheetName, detail: "raw workbook rows" },
        { label: "Rows", value: formatNumber(filteredRows.length), detail: `${tableRows.length} groups returned` },
        { label: "Query Type", value: "group count", detail: confidence },
        { label: "Group By", value: displayGroupColumn, detail: terms.join(", ") || "No filters" },
      ],
      charts: [bar("Grouped Result Counts", tableRows.slice(0, 10).map((row) => ({ label: row[0], value: number(row[1]), color: "#5899C4" })))],
      tables: [{ title: "Grouped Query Results", headers: [displayGroupColumn, "Count"], rows: tableRows }],
      json: {
        genericDatasetQuery: {
          query: message,
          queryType: "group_count",
          tableName: selected.sheetName,
          tableDisplayName: selected.sheetName,
          confidence,
          filters: terms,
          groupBy: groupColumn,
          totalMatchingRows: filteredRows.length,
          returnedRows: tableRows.length,
          headers: [displayGroupColumn, "Count"],
          rows: tableRows,
        },
        evidence: [
          `Generic DB Query Tool selected workbook sheet ${selected.sheetName}.`,
          enriched.joined ? "Joined related raw workbook rows so filters can match connected people, opportunities, and roles." : "No related-sheet join was needed for this lookup.",
          `Grouped filtered rows by ${displayGroupColumn}.`,
        ],
      },
    };
  }

  const displayColumns = uniqueText([...enriched.preferredColumns, ...rawColumns]).slice(0, 10);
  const headers = displayColumns.map((column) => cloudAliasFor(dataset, selected.sheetName, column) || cloudColumnLabel(column));
  const tableRows = filteredRows.slice(0, 25).map((row) => displayColumns.map((column) => text(row[column])));
  return {
    view: "table-query",
    title: "Dataset Query Evidence",
    summary: `Returned ${tableRows.length} of ${filteredRows.length} matching row(s) from ${selected.sheetName}.`,
    cards: [
      { label: "Sheet", value: selected.sheetName, detail: "raw workbook rows" },
      { label: "Rows", value: formatNumber(filteredRows.length), detail: `${tableRows.length} returned` },
      { label: "Query Type", value: "list", detail: confidence },
      { label: "Filters", value: terms.length ? formatNumber(terms.length) : "0", detail: terms.join(", ") || "No filters" },
    ],
    charts: [],
    tables: [{ title: "Query Results", headers, rows: tableRows }],
    json: {
      genericDatasetQuery: {
        query: message,
        queryType: "list",
        tableName: selected.sheetName,
        tableDisplayName: selected.sheetName,
        confidence,
        filters: terms,
        totalMatchingRows: filteredRows.length,
        returnedRows: tableRows.length,
        headers,
        rows: tableRows,
      },
      evidence: [
        `Generic DB Query Tool selected workbook sheet ${selected.sheetName}.`,
        enriched.joined ? "Joined related raw workbook rows so filters can match connected people, opportunities, and roles." : "No related-sheet join was needed for this lookup.",
        terms.length ? `Applied filter term(s): ${terms.join(", ")}.` : "No value filters were needed for this lookup.",
        "Read raw workbook rows from D1 and returned a row-limited result table.",
      ],
    },
  };
};

const dashboardDetails = (snapshot: WorkforceStaticDashboardSnapshot, message: string): WorkspaceChatDetails => {
  const view = chooseDetailView(message);
  const summary = record(snapshot.sections.summary);
  const kpis = record(summary.kpis);
  const supply = record(snapshot.sections.supply);
  const demand = record(snapshot.sections.demand);
  const staffingFit = record(snapshot.sections.staffingFit);
  const skills = record(snapshot.sections.skills);
  const ewa = record(snapshot.sections.ewa);
  const topOpportunity = records(demand.topOpportunities)[0] ?? {};
  const topCandidate = records(staffingFit.topCandidatePerRole)[0] ?? {};
  const topGap = records(skills.skillGaps)[0] ?? {};
  const topRisk = records(supply.highRiskPeople)[0] ?? {};
  const baseCards: DetailCard[] = [
    { label: "People", value: formatNumber(number(kpis.people)), detail: `${formatNumber(number(kpis.availableFteCurrent))} available FTE` },
    { label: "Roles", value: formatNumber(number(kpis.roles)), detail: `${formatNumber(number(kpis.requiredFte))} required FTE` },
    { label: "Feasible", value: `${formatNumber(number(kpis.feasibleRoles))}/${formatNumber(number(kpis.totalRoles))}`, detail: "roles with direct fit" },
    { label: "EWA", value: formatNumber(number(kpis.pendingEwaRequests)), detail: "pending approvals" },
  ];

  if (view === "skill-gaps") {
    return {
      view,
      title: "Skill Gap Evidence",
      summary: topGap.skillName
        ? `${text(topGap.skillName)} has the largest required-skill gap: ${formatNumber(number(topGap.gap))} more role(s) than available people.`
        : "No required skill gaps were found in the uploaded workbook.",
      cards: [
        { label: "Top Gap", value: text(topGap.skillName) || "None", detail: `${formatNumber(number(topGap.gap))} gap` },
        ...baseCards.slice(0, 3),
      ],
      charts: [
        bar(
          "Required Skill Gaps",
          records(skills.skillGaps)
            .slice(0, 8)
            .map((row) => ({ label: text(row.skillName), value: number(row.gap), color: "#ff5640" })),
        ),
      ],
      tables: [
        {
          title: "No-Supply Skill Gaps",
          headers: ["Skill", "Required", "Supply", "Gap"],
          rows: records(skills.skillGaps).map((row) => [
            text(row.skillName),
            formatNumber(number(row.requiredRoles)),
            formatNumber(number(row.people)),
            formatNumber(number(row.gap)),
          ]),
        },
      ],
      json: { skillGaps: skills.skillGaps },
    };
  }

  if (view === "supply-risk") {
    return {
      view,
      title: "Supply Evidence",
      summary: topRisk.name
        ? `${text(topRisk.name)} is a high-risk supply record with ${formatNumber(number(topRisk.supplyFte))} FTE and ${formatNumber(number(topRisk.timeOnSupplyDays))} days on supply.`
        : `Current supply has ${formatNumber(number(kpis.currentBenchPeople))} current bench people and ${formatNumber(number(kpis.partialCapacityPeople))} partial-capacity people.`,
      cards: [
        { label: "Current Bench", value: formatNumber(number(kpis.currentBenchPeople)), detail: "people" },
        { label: "Partial", value: formatNumber(number(kpis.partialCapacityPeople)), detail: "people" },
        { label: "High Risk", value: formatNumber(number(kpis.highRiskSupplyPeople)), detail: "supply records" },
        { label: "Available FTE", value: formatNumber(number(kpis.availableFteCurrent)), detail: "current" },
      ],
      charts: [
        bar(
          "Capacity by Release Window",
          records(supply.benchMovement)
            .slice(0, 12)
            .map((row) => ({ label: text(row.weekStartDate), value: number(row.availableFte), color: "#5899c4" })),
        ),
        bar(
          "Availability Mix",
          records(supply.availabilityByCategory).map((row) => ({
            label: text(row.availabilityCategory),
            value: number(row.availableFte),
            color: "#30a661",
          })),
        ),
      ],
      tables: [
        {
          title: "High Risk People",
          headers: ["Person", "Discipline", "FTE", "Days", "Action"],
          rows: records(supply.highRiskPeople)
            .slice(0, 10)
            .map((row) => [
              text(row.name),
              text(row.discipline),
              formatNumber(number(row.supplyFte)),
              formatNumber(number(row.timeOnSupplyDays)),
              text(row.suggestedAction),
            ]),
        },
      ],
      json: { supply, ewa },
    };
  }

  if (view === "demand") {
    return {
      view,
      title: "Demand Evidence",
      summary: topOpportunity.name
        ? `${text(topOpportunity.name)} is the top priority demand item with ${formatNumber(number(topOpportunity.requiredFte))} required FTE.`
        : "Demand evidence was loaded from the uploaded workbook.",
      cards: [
        { label: "Top Opportunity", value: text(topOpportunity.name) || "n/a", detail: text(topOpportunity.stage) },
        { label: "Required FTE", value: formatNumber(number(kpis.requiredFte)), detail: "pipeline total" },
        { label: "Roles", value: formatNumber(number(kpis.roles)), detail: "required roles" },
        { label: "Opportunities", value: formatNumber(number(kpis.opportunities)), detail: "pipeline" },
      ],
      charts: [
        bar(
          "Demand by Stage",
          records(demand.demandByStage).map((row) => ({ label: text(row.stage), value: number(row.requiredFte), color: "#ff5640" })),
        ),
      ],
      tables: [
        {
          title: "Top Opportunities",
          headers: ["Opportunity", "Client", "Stage", "FTE", "Start"],
          rows: records(demand.topOpportunities).map((row) => [
            text(row.name),
            text(row.clientName),
            text(row.stage),
            formatNumber(number(row.requiredFte)),
            text(row.expectedStartDate),
          ]),
        },
      ],
      json: { demand },
    };
  }

  return {
    view: "staffing-fit",
    title: "Staffing Fit Evidence",
    summary: topCandidate.personName
      ? `${text(topCandidate.personName)} is the top candidate for ${text(topCandidate.roleName)} on ${text(topCandidate.opportunityName)}.`
      : "Staffing fit evidence was loaded from the uploaded workbook.",
    cards: [
      { label: "Candidate", value: text(topCandidate.personName) || "n/a", detail: text(topCandidate.roleName) },
      ...baseCards.slice(1),
    ],
    charts: [
      bar(
        "Fit Distribution",
        records(staffingFit.fitDistribution).map((row) => ({ label: text(row.fitStatus), value: number(row.candidates), color: "#5899c4" })),
      ),
    ],
    tables: [
      {
        title: "Top Candidate Per Role",
        headers: ["Opportunity", "Role", "Person", "Score", "Gap", "EWA"],
        rows: records(staffingFit.topCandidatePerRole)
          .slice(0, 10)
          .map((row) => [
            text(row.opportunityName),
            text(row.roleName),
            text(row.personName),
            formatNumber(number(row.overallStaffingScore)),
            formatNumber(number(row.fteGap)),
            text(row.ewaStatus),
          ]),
      },
    ],
    json: { staffingFit },
  };
};

const markdownBullets = (items: string[]) => items.filter(Boolean).map((item) => `- ${item}`).join("\n");

const piiRefusalMessage = () =>
  markdownBullets([
    "I can't provide direct or indirect personal identifiers such as SSNs, passport or driver's license numbers, biometric data, employee IDs, full legal names, dates of birth, addresses, phone numbers, or personal email addresses.",
    "Ask for aggregated counts, non-identifying summaries, or role/skill/availability evidence without personal identifiers.",
  ]);

const chatRoute = (details: WorkspaceChatDetails) => ({
  intent:
    details.view === "table-query"
      ? "generic_dataset_query"
      : details.view === "skill-gaps"
      ? "risk_insights"
      : details.view === "supply-risk"
        ? "resource_supply"
        : details.view === "demand"
          ? "opportunity_assessment"
          : "team_builder",
  confidence: "Medium",
  reason:
    details.view === "table-query"
      ? "Cloudflare route answered with a generic read-only dataset query over uploaded workbook rows."
      : "Cloudflare route answered from the persisted D1 dashboard snapshot for this uploaded dataset.",
  executionMode: details.view === "table-query" ? "tool_orchestrated" : "cloud_dashboard_snapshot",
  plannedAgentPath: [details.view === "table-query" ? "Generic DB Query Tool" : "Cloudflare D1 Snapshot Tool"],
  executionPlan: [
    {
      order: 1,
      agent: details.view === "table-query" ? "Generic DB Query Tool" : "Cloudflare D1 Snapshot Tool",
      purpose:
        details.view === "table-query"
          ? "Map the user question to uploaded workbook rows and return a safe result table."
          : "Read uploaded workbook facts from the persisted dashboard snapshot.",
      dependsOn: [],
    },
  ],
  skippedAgents: [],
});

const workforceChatPOST: RouteHandler = async (request) => {
  const { DB } = await requireRuntime();
  try {
    const body = (await request.json()) as {
      userId?: string;
      datasetId?: string;
      conversationId?: string;
      message?: string;
    };
    const userId = text(body.userId);
    const datasetId = text(body.datasetId);
    const requestConversationId = text(body.conversationId);
    const userMessage = text(body.message);
    if (!userMessage) throw new HttpError(400, "message is required.");
    const user = userId ? await getCloudDummyUserById(DB, userId) : null;
    if (isPiiRequest(userMessage)) {
      const route = privacyBlockedRoute();
      const assistantMessage = piiRefusalMessage();

      if (!datasetId) {
        return json({
          status: "success",
          conversationId: requestConversationId || `chat_${crypto.randomUUID()}`,
          message: assistantMessage,
          detailView: null,
          details: null,
          agentsUsed: [],
          route,
        });
      }

      if (!user) throw new HttpError(404, "Dataset not found.");
      await assertCloudDatasetOwnedByUser(DB, datasetId, userId);
      const conversation = await getOrCreateCloudWorkforceConversation(DB, {
        conversationId: requestConversationId,
        userId,
        datasetId,
        firstMessage: userMessage,
      });
      await appendCloudWorkforceConversationMessage(DB, {
        conversationId: conversation.id,
        role: "user",
        content: userMessage,
      });
      await appendCloudWorkforceConversationMessage(DB, {
        conversationId: conversation.id,
        role: "assistant",
        content: assistantMessage,
        detailView: null,
        details: null,
      });
      await updateCloudWorkforceConversationMemory(DB, {
        conversationId: conversation.id,
        lastDetailView: null,
        lastSummary: assistantMessage,
        title: conversation.title,
      });
      return json({
        status: "success",
        conversationId: conversation.id,
        message: assistantMessage,
        detailView: null,
        details: null,
        agentsUsed: [],
        route,
      });
    }

    if (!datasetId) {
      const route = {
        intent: "general",
        confidence: "High",
        reason: "No datasetId was provided.",
        executionMode: "needs_context",
        plannedAgentPath: [],
        executionPlan: [],
        skippedAgents: [],
      };
      return json({
        status: "success",
        conversationId: requestConversationId || `chat_${crypto.randomUUID()}`,
        message: markdownBullets([
          "I can help with opportunity assessment, supply, staffing fit, skill gaps, and EWA evidence once you select or upload a dataset.",
        ]),
        detailView: null,
        details: null,
        agentsUsed: [],
        route,
      });
    }
    if (!user) throw new HttpError(404, "Dataset not found.");
    const dataset = await assertCloudDatasetOwnedByUser(DB, datasetId, userId);
    const snapshot = dataset.staticDashboard;
    if (!snapshot) throw new HttpError(404, "Dataset dashboard snapshot not found.");
    const conversation = await getOrCreateCloudWorkforceConversation(DB, {
      conversationId: requestConversationId,
      userId,
      datasetId,
      firstMessage: userMessage,
    });
    let previousMessages: CloudChatContextMessage[] = [];
    if (requestConversationId) {
      try {
        previousMessages = (await readCloudWorkforceConversation(DB, {
          conversationId: requestConversationId,
          userId,
          datasetId,
        })).messages as CloudChatContextMessage[];
      } catch {
        previousMessages = [];
      }
    }
    const genericQueryMessage = contextualCloudGenericQueryMessage(userMessage, previousMessages);
    const details =
      (await cloudGenericDatasetQueryDetails(DB, dataset, genericQueryMessage)) ??
      (await cloudPeopleSkillDetails(DB, dataset, genericQueryMessage)) ??
      dashboardDetails(snapshot, userMessage);
    const route = chatRoute(details);
    const responseDetails: WorkspaceChatDetails = {
      ...details,
      json: {
        ...details.json,
        router: route,
      },
    };
    const assistantMessage = markdownBullets([
      responseDetails.summary,
      "Open details for the evidence tables and charts from this uploaded workbook.",
    ]);
    await appendCloudWorkforceConversationMessage(DB, {
      conversationId: conversation.id,
      role: "user",
      content: userMessage,
    });
    await appendCloudWorkforceConversationMessage(DB, {
      conversationId: conversation.id,
      role: "assistant",
      content: assistantMessage,
      detailView: responseDetails.view,
      details: responseDetails,
    });
    await updateCloudWorkforceConversationMemory(DB, {
      conversationId: conversation.id,
      lastDetailView: responseDetails.view,
      lastSummary: assistantMessage,
      title: conversation.title,
    });
    return json({
      status: "success",
      conversationId: conversation.id,
      message: assistantMessage,
      detailView: responseDetails.view,
      details: responseDetails,
      agentsUsed: route.plannedAgentPath,
      route,
    });
  } catch (error) {
    if (error instanceof HttpError) return json({ status: "failure", error: error.message }, error.statusCode);
    const message = error instanceof Error ? error.message : "Failed to answer workforce question.";
    return json({ status: "failure", error: message }, 500);
  }
};

const notFound = () => json({ status: "failure", error: "API route not found." }, 404);
const methodNotAllowed = () => json({ status: "failure", error: "Method not allowed." }, 405);

export async function GET(request: Request, apiPath: string) {
  if (apiPath === "auth/roles") return authRolesGET(request);
  if (apiPath === "workforce-datasets/events") return workforceEventsGET(request);
  if (apiPath === "workforce-datasets/raw") return workforceRawGET(request);
  if (apiPath === "workforce-datasets/download") return workforceDownloadGET(request);
  if (apiPath === "workforce-datasets/schema-validation") return workforceSchemaValidationGET(request);
  if (apiPath === "workforce-datasets/dashboard" || apiPath.startsWith("workforce-datasets/dashboard/")) {
    return workforceDashboardGET(request, apiPath.split("/").slice(2));
  }
  if (apiPath === "workforce-datasets") return workforceDatasetsGET(request);
  if (apiPath === "workforce-chats" || apiPath.startsWith("workforce-chats/")) {
    return workforceChatsGET(request, apiPath.split("/").slice(1));
  }
  if (apiPath === "workforce-conversations" || apiPath.startsWith("workforce-conversations/")) {
    return workforceConversationsGET(request, apiPath.split("/").slice(1));
  }
  return notFound();
}

export async function POST(request: Request, apiPath: string) {
  if (apiPath === "auth/login") return authLoginPOST(request);
  if (apiPath === "auth/roles") return authRolesPOST(request);
  if (apiPath === "workforce-chat") return workforceChatPOST(request);
  if (apiPath === "workforce-datasets/schema-validation") return workforceSchemaValidationPOST(request);
  if (apiPath === "workforce-datasets") return workforceDatasetsPOST(request);
  return notFound();
}

export async function PATCH(request: Request, apiPath: string) {
  if (apiPath === "workforce-datasets") return workforceDatasetsPATCH(request);
  return notFound();
}

export async function DELETE(request: Request, apiPath: string) {
  if (apiPath.startsWith("workforce-chats/")) return workforceChatsDELETE(request, apiPath.split("/").slice(1));
  return methodNotAllowed();
}
