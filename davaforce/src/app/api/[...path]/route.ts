import { hasCloudflareRuntime } from "../../../../backend/src/cloudflare/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ path?: string[] }> | { path?: string[] };
};

type LocalRoutes = {
  authRolesGET: (request: Request) => Promise<Response>;
  authRolesPOST: (request: Request) => Promise<Response>;
  loginPOST: (request: Request) => Promise<Response>;
  workforceChatPOST: (request: Request) => Promise<Response>;
  workforceChatsDELETE: (request: Request, path?: string[]) => Promise<Response>;
  workforceChatsGET: (request: Request, path?: string[]) => Promise<Response>;
  workforceConversationsGET: (request: Request, path?: string[]) => Promise<Response>;
  workforceDashboardGET: (request: Request, path?: string[]) => Promise<Response>;
  workforceDownloadGET: (request: Request) => Promise<Response>;
  workforceEventsGET: (request: Request) => Promise<Response>;
  workforceGET: (request: Request) => Promise<Response>;
  workforcePATCH: (request: Request) => Promise<Response>;
  workforcePOST: (request: Request) => Promise<Response>;
  workforceRawGET: (request: Request) => Promise<Response>;
  workforceSchemaValidationGET: (request: Request) => Promise<Response>;
  workforceSchemaValidationPOST: (request: Request) => Promise<Response>;
};

const notFound = () => Response.json({ status: "failure", error: "API route not found." }, { status: 404 });
const methodNotAllowed = () => Response.json({ status: "failure", error: "Method not allowed." }, { status: 405 });

async function getApiPath(context: RouteContext) {
  const { path = [] } = await context.params;
  return path.join("/");
}

async function loadLocalRoutes(): Promise<LocalRoutes> {
  const [
    datasetsRoute,
    dashboardRoute,
    chatRoute,
    chatsRoute,
    conversationsRoute,
    loginRoute,
    authRolesRoute,
  ] = await Promise.all([
    import("../../../../backend/src/next/workforce-datasets-route"),
    import("../../../../backend/src/next/workforce-dashboard-route"),
    import("../../../../backend/src/next/workforce-chat-route"),
    import("../../../../backend/src/next/workforce-chats-route"),
    import("../../../../backend/src/next/workforce-conversations-route"),
    import("../../../../backend/src/next/auth-login-route"),
    import("../../../../backend/src/next/auth-roles-route"),
  ]);

  return {
    authRolesGET: authRolesRoute.GET,
    authRolesPOST: authRolesRoute.POST,
    loginPOST: loginRoute.POST,
    workforceChatPOST: chatRoute.POST,
    workforceChatsDELETE: chatsRoute.DELETE,
    workforceChatsGET: chatsRoute.GET,
    workforceConversationsGET: conversationsRoute.GET,
    workforceDashboardGET: dashboardRoute.GET,
    workforceDownloadGET: datasetsRoute.GET_DOWNLOAD,
    workforceEventsGET: datasetsRoute.GET_EVENTS,
    workforceGET: datasetsRoute.GET,
    workforcePATCH: datasetsRoute.PATCH,
    workforcePOST: datasetsRoute.POST,
    workforceRawGET: datasetsRoute.GET_RAW,
    workforceSchemaValidationGET: datasetsRoute.GET_SCHEMA_VALIDATION,
    workforceSchemaValidationPOST: datasetsRoute.POST_SCHEMA_VALIDATION,
  };
}

async function useCloudflareApi() {
  if (!(await hasCloudflareRuntime())) {
    return null;
  }
  return import("../../../../backend/src/cloudflare/api-route");
}

export async function GET(request: Request, context: RouteContext) {
  const apiPath = await getApiPath(context);
  const cloudflareApi = await useCloudflareApi();
  if (cloudflareApi) {
    return cloudflareApi.GET(request, apiPath);
  }

  const routes = await loadLocalRoutes();
  if (apiPath === "auth/roles") return routes.authRolesGET(request);
  if (apiPath === "workforce-datasets/events") return routes.workforceEventsGET(request);
  if (apiPath === "workforce-datasets/raw") return routes.workforceRawGET(request);
  if (apiPath === "workforce-datasets/download") return routes.workforceDownloadGET(request);
  if (apiPath === "workforce-datasets/schema-validation") return routes.workforceSchemaValidationGET(request);
  if (apiPath === "workforce-datasets/dashboard" || apiPath.startsWith("workforce-datasets/dashboard/")) {
    return routes.workforceDashboardGET(request, apiPath.split("/").slice(2));
  }
  if (apiPath === "workforce-datasets") return routes.workforceGET(request);
  if (apiPath === "workforce-chats" || apiPath.startsWith("workforce-chats/")) {
    return routes.workforceChatsGET(request, apiPath.split("/").slice(1));
  }
  if (apiPath === "workforce-conversations" || apiPath.startsWith("workforce-conversations/")) {
    return routes.workforceConversationsGET(request, apiPath.split("/").slice(1));
  }
  return notFound();
}

export async function POST(request: Request, context: RouteContext) {
  const apiPath = await getApiPath(context);
  const cloudflareApi = await useCloudflareApi();
  if (cloudflareApi) {
    return cloudflareApi.POST(request, apiPath);
  }

  const routes = await loadLocalRoutes();
  if (apiPath === "auth/login") return routes.loginPOST(request);
  if (apiPath === "auth/roles") return routes.authRolesPOST(request);
  if (apiPath === "workforce-chat") return routes.workforceChatPOST(request);
  if (apiPath === "workforce-datasets/schema-validation") return routes.workforceSchemaValidationPOST(request);
  if (apiPath === "workforce-datasets") return routes.workforcePOST(request);
  return notFound();
}

export async function PATCH(request: Request, context: RouteContext) {
  const apiPath = await getApiPath(context);
  const cloudflareApi = await useCloudflareApi();
  if (cloudflareApi) {
    return cloudflareApi.PATCH(request, apiPath);
  }

  const routes = await loadLocalRoutes();
  if (apiPath === "workforce-datasets") return routes.workforcePATCH(request);
  return notFound();
}

export async function PUT() {
  return methodNotAllowed();
}

export async function DELETE(request: Request, context: RouteContext) {
  const apiPath = await getApiPath(context);
  const cloudflareApi = await useCloudflareApi();
  if (cloudflareApi) {
    return cloudflareApi.DELETE(request, apiPath);
  }

  const routes = await loadLocalRoutes();
  if (apiPath.startsWith("workforce-chats/")) return routes.workforceChatsDELETE(request, apiPath.split("/").slice(1));
  return methodNotAllowed();
}
