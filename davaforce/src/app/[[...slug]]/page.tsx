import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import HomePage from "../../../frontend/src/app/page";
import AskPage from "../../../frontend/src/app/ask/page";
import ValidatePage from "../../../frontend/src/app/validate/page";
import WorkspacePage from "../../../frontend/src/app/workspace/page";
import Dashboard from "../../../frontend/src/app/dashboard/page";
import { DashboardShell } from "../../../frontend/src/components/dashboard-shell";

type PageProps = {
  params: Promise<{ slug?: string[] }> | { slug?: string[] };
};

export default async function RouteBridge({ params }: PageProps) {
  const { slug = [] } = await params;
  const routeKey = slug.join("/");

  if (!routeKey) {
    return <HomePage />;
  }

  if (routeKey === "ask") {
    return <AskPage />;
  }

  if (routeKey === "validate") {
    return <ValidatePage />;
  }

  if (routeKey === "workspace") {
    return <WorkspacePage />;
  }

  if (routeKey === "dashboard") {
    return <WorkspaceShell><Dashboard /></WorkspaceShell>;
  }

  notFound();
}

function WorkspaceShell({ children }: { children: ReactNode }) {
  return <DashboardShell>{children}</DashboardShell>;
}
