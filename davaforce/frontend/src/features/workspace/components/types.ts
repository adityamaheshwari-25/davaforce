export type DashboardView = "overview" | "staffing-fit" | "supply-risk" | "skill-gaps" | "demand" | "table-query";

export type WorkspaceDetailCard = {
  label: string;
  value: string;
  detail?: string;
};

export type WorkspaceDetailChart = {
  type: "bar";
  title: string;
  data: Array<{ label: string; value: number; color?: string }>;
};

export type WorkspaceDetailTable = {
  title: string;
  headers: string[];
  rows: string[][];
};

export type WorkspaceAgentDetails = {
  view: DashboardView;
  title: string;
  summary: string;
  cards: WorkspaceDetailCard[];
  charts: WorkspaceDetailChart[];
  tables: WorkspaceDetailTable[];
  json: Record<string, unknown>;
};

export type ChatMessage = {
  id: string;
  role: "user" | "ai";
  text: string;
  detailView?: DashboardView | null;
  details?: WorkspaceAgentDetails | null;
};

export type ChatConversationSummary = {
  id: string;
  title: string;
  datasetId: string;
  updatedAt: string;
  activeOpportunityName: string | null;
  lastDetailView: DashboardView | null;
  messageCount: number;
  lastMessage: string | null;
};
