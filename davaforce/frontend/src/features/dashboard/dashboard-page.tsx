"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  BriefcaseBusiness,
  CheckCircle2,
  Download,
  Eye,
  FileSpreadsheet,
  Gauge,
  ShieldCheck,
  Sparkles,
  TableProperties,
  X,
  Users,
  Wrench,
} from "lucide-react";
import { AppTopbar } from "@/components/app-topbar";
import { Button } from "@/components/ui/button";
import {
  ActionCards,
  AvailabilityDonut,
  BenchTrendChart,
  CandidateScoreChart,
  CoverageRadial,
  DashboardCard,
  DataTable,
  DemandPipelineChart,
  EmptyState,
  EwaBadge,
  EwaStatusChart,
  FitBadge,
  FitDistributionChart,
  HorizontalBarChart,
  KpiCard,
  LoadingState,
  RiskBadge,
  RiskMixChart,
  RiskPriorityBoard,
  SectionTabs,
  SkillGapChart,
  SkillSupplyRadarLike,
  StackedText,
  SummaryBalanceChart,
  formatFte,
  numberFormat,
} from "@/features/dashboard/components/dashboard-widgets";
import type { DashboardFailure, DashboardPayload } from "@/features/dashboard/dashboard-types";
import { isDatasetSchemaValidated } from "@/lib/workforce-schema-validation";

type LoginUser = {
  userId: string;
  username: string;
};

type DashboardView = "summary" | "supply" | "demand" | "staffing-fit" | "skills" | "ewa";

type RawWorkbookSheet = {
  sheetName: string;
  rows: number;
};

type RawWorkbookRow = {
  sourceRowNumber: number;
  naturalKey: string;
  payload: Record<string, unknown>;
};

type RawWorkbookPayload = {
  status: "success";
  dataset: {
    originalFileName: string;
  };
  sheets: RawWorkbookSheet[];
  selectedSheetName: string;
  limit: number;
  offset: number;
  rows: RawWorkbookRow[];
};

type RawWorkbookFailure = {
  status: "failure";
  error: string;
};

const dashboardViewTitles: Record<DashboardView, string> = {
  summary: "Summary",
  supply: "Supply",
  demand: "Demand",
  "staffing-fit": "Staffing Fit",
  skills: "Skills",
  ewa: "EWA",
};

function getDashboardView(value: string | null): DashboardView {
  if (value === "supply" || value === "demand" || value === "staffing-fit" || value === "skills" || value === "ewa") {
    return value;
  }
  return "summary";
}

export default function Dashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeView = getDashboardView(searchParams.get("view"));
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [userId, setUserId] = useState("");
  const [datasetId, setDatasetId] = useState("");
  const [isRawOpen, setIsRawOpen] = useState(false);
  const [isRawLoading, setIsRawLoading] = useState(false);
  const [rawError, setRawError] = useState("");
  const [rawWorkbook, setRawWorkbook] = useState<RawWorkbookPayload | null>(null);

  const loadDashboard = useCallback(async () => {
    setIsLoading(true);
    setError("");

    try {
      const storedUser = window.localStorage.getItem("workforceUser");
      const datasetId = window.localStorage.getItem("workforceDatasetId");
      const user = storedUser ? (JSON.parse(storedUser) as LoginUser) : null;

      if (!user?.userId) {
        setDashboard(null);
        setUserId("");
        setDatasetId("");
        router.replace("/");
        return;
      }

      if (!datasetId) {
        setDashboard(null);
        setUserId(user.userId);
        setDatasetId("");
        router.replace("/?action=upload");
        return;
      }

      if (!(await isDatasetSchemaValidated(user.userId, datasetId))) {
        setDashboard(null);
        setUserId(user.userId);
        setDatasetId(datasetId);
        router.replace("/validate");
        return;
      }

      setUserId(user.userId);
      setDatasetId(datasetId);
      const params = new URLSearchParams({ userId: user.userId, datasetId });
      const response = await fetch(`/api/workforce-datasets/dashboard?${params.toString()}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as DashboardPayload | DashboardFailure;

      if (!response.ok || payload.status !== "success") {
        throw new Error("error" in payload ? payload.error : "Failed to load dashboard.");
      }

      setDashboard(payload);
    } catch (loadError) {
      setDashboard(null);
      setError(loadError instanceof Error ? loadError.message : "Failed to load dashboard.");
    } finally {
      setIsLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const rawRequestParams = useCallback(
    (sheetName?: string) => {
      const params = new URLSearchParams({ userId, datasetId, limit: "50" });
      if (sheetName) {
        params.set("sheet", sheetName);
      }
      return params;
    },
    [datasetId, userId],
  );

  const loadRawWorkbook = useCallback(
    async (sheetName?: string) => {
      if (!userId || !datasetId) return;

      setIsRawLoading(true);
      setRawError("");
      try {
        const response = await fetch(`/api/workforce-datasets/raw?${rawRequestParams(sheetName).toString()}`, {
          cache: "no-store",
        });
        const payload = (await response.json()) as RawWorkbookPayload | RawWorkbookFailure;
        if (!response.ok || payload.status !== "success") {
          throw new Error("error" in payload ? payload.error : "Failed to load raw workbook rows.");
        }
        setRawWorkbook(payload);
      } catch (rawLoadError) {
        setRawError(rawLoadError instanceof Error ? rawLoadError.message : "Failed to load raw workbook rows.");
      } finally {
        setIsRawLoading(false);
      }
    },
    [datasetId, rawRequestParams, userId],
  );

  const toggleRawWorkbook = () => {
    if (isRawOpen) {
      setIsRawOpen(false);
      return;
    }

    setIsRawOpen(true);
    if (!rawWorkbook) {
      void loadRawWorkbook();
    }
  };

  const downloadWorkbook = () => {
    if (!userId || !datasetId) return;
    window.location.assign(`/api/workforce-datasets/download?${new URLSearchParams({ userId, datasetId }).toString()}`);
  };

  return (
    <>
      <AppTopbar
        title={dashboardViewTitles[activeView]}
        subtitle={dashboard ? `Source: ${dashboard.summary.sourceName}` : "Static snapshot stored with the uploaded workforce dataset"}
        action={
          dashboard ? (
            <>
              <Button
                type="button"
                variant="outline"
                className="h-10 border-[var(--home-border)] bg-[var(--home-panel)] text-[var(--home-text)] hover:bg-[var(--home-soft)]"
                onClick={toggleRawWorkbook}
              >
                {isRawOpen ? <X className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                {isRawOpen ? "Hide raw Excel" : "View raw Excel"}
              </Button>
              <Button
                type="button"
                className="h-10 bg-brand text-brand-foreground hover:bg-brand/90"
                onClick={downloadWorkbook}
              >
                <Download className="h-4 w-4" />
                Download Excel
              </Button>
            </>
          ) : null
        }
      />

      <div className="space-y-5 px-5 py-5 md:px-6">
        {isLoading ? <LoadingState /> : null}
        {!isLoading && error ? <EmptyState message={error} /> : null}
        {!isLoading && dashboard && isRawOpen ? (
          <RawWorkbookPanel
            data={rawWorkbook}
            error={rawError}
            isLoading={isRawLoading}
            onClose={() => setIsRawOpen(false)}
            onSelectSheet={(sheetName) => void loadRawWorkbook(sheetName)}
          />
        ) : null}
        {!isLoading && dashboard ? <DashboardContent activeView={activeView} dashboard={dashboard} /> : null}
      </div>
    </>
  );
}

function rawCellText(value: unknown) {
  if (value == null) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function RawWorkbookPanel({
  data,
  error,
  isLoading,
  onClose,
  onSelectSheet,
}: {
  data: RawWorkbookPayload | null;
  error: string;
  isLoading: boolean;
  onClose: () => void;
  onSelectSheet: (sheetName: string) => void;
}) {
  const payloadKeys = Array.from(new Set(data?.rows.flatMap((row) => Object.keys(row.payload)) ?? []));
  const columns = payloadKeys.slice(0, 18);
  const selectedSheet = data?.sheets.find((sheet) => sheet.sheetName === data.selectedSheetName);

  return (
    <DashboardCard
      title="Raw Excel Preview"
      subtitle={data ? `${data.dataset.originalFileName} - ${data.selectedSheetName || "No sheet selected"}` : "Loading source workbook rows"}
      icon={FileSpreadsheet}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <select
            className="h-10 max-w-full rounded-lg border border-[var(--home-border)] bg-[var(--home-panel-strong)] px-3 text-sm text-[var(--home-text)] outline-none"
            value={data?.selectedSheetName ?? ""}
            disabled={!data || isLoading}
            onChange={(event) => onSelectSheet(event.target.value)}
          >
            {(data?.sheets ?? []).map((sheet) => (
              <option key={sheet.sheetName} value={sheet.sheetName}>
                {sheet.sheetName} ({sheet.rows})
              </option>
            ))}
          </select>
          <span className="text-xs text-[var(--home-muted)]">
            {selectedSheet ? `Showing ${data?.rows.length ?? 0} of ${selectedSheet.rows} rows` : "Reading workbook sheets"}
          </span>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="border-[var(--home-border)] bg-[var(--home-panel)] text-[var(--home-text)] hover:bg-[var(--home-soft)]"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
          Close
        </Button>
      </div>

      {isLoading ? (
        <div className="rounded-xl border border-dashed border-[var(--home-border)] bg-[var(--home-soft)] px-5 py-10 text-center text-sm text-[var(--home-muted)]">
          Loading raw workbook rows...
        </div>
      ) : error ? (
        <div className="rounded-xl border border-brand/30 bg-brand/10 px-4 py-3 text-sm text-brand">{error}</div>
      ) : data?.rows.length ? (
        <div className="rounded-xl border border-[var(--home-border)]">
          <div className="smooth-chat-scroll max-h-[28rem] overflow-auto">
            <table className="w-full min-w-[760px] text-left text-xs">
              <thead className="sticky top-0 z-10 bg-[var(--home-soft)] text-[var(--home-muted)]">
                <tr>
                  <th className="px-3 py-2.5 font-medium">Excel Row</th>
                  <th className="px-3 py-2.5 font-medium">Natural Key</th>
                  {columns.map((column) => (
                    <th key={column} className="px-3 py-2.5 font-medium">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={`${row.sourceRowNumber}-${row.naturalKey}`} className="border-t border-[var(--home-border)]">
                    <td className="whitespace-nowrap px-3 py-2.5 text-[var(--home-muted)]">{row.sourceRowNumber}</td>
                    <td className="max-w-[12rem] truncate px-3 py-2.5 text-[var(--home-text)]">{row.naturalKey}</td>
                    {columns.map((column) => (
                      <td key={column} className="max-w-[18rem] truncate px-3 py-2.5 text-[var(--home-text)]">
                        {rawCellText(row.payload[column])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-[var(--home-border)] bg-[var(--home-soft)] px-5 py-10 text-center text-sm text-[var(--home-muted)]">
          No raw rows found for this workbook.
        </div>
      )}
    </DashboardCard>
  );
}

function DashboardContent({ activeView, dashboard }: { activeView: DashboardView; dashboard: DashboardPayload }) {
  const { summary, supply, demand, staffingFit, skills, ewa } = dashboard;
  const feasiblePercent = summary.kpis.totalRoles ? Math.round((summary.kpis.feasibleRoles / summary.kpis.totalRoles) * 100) : 0;
  const fteGap = summary.kpis.requiredFte - summary.kpis.availableFteCurrent;

  if (activeView === "summary") {
    return (
      <SectionTabs
        tabs={[
          {
            id: "kpis",
            label: "KPI Cards",
            content: (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
                <KpiCard label="People" value={numberFormat.format(summary.kpis.people)} detail="Normalized workforce records" icon={Users} />
                <KpiCard label="Required FTE" value={formatFte(summary.kpis.requiredFte)} detail={`${summary.kpis.roles} demand roles`} icon={BriefcaseBusiness} />
                <KpiCard label="Available FTE" value={formatFte(summary.kpis.availableFteCurrent)} detail={`${formatFte(fteGap)} net gap`} icon={Gauge} accent={fteGap > 0 ? "warn" : "good"} />
                <KpiCard label="Feasible Roles" value={`${summary.kpis.feasibleRoles}/${summary.kpis.totalRoles}`} detail={`${feasiblePercent}% have feasible coverage`} icon={CheckCircle2} accent="good" />
                <KpiCard label="High Risk" value={numberFormat.format(summary.kpis.highRiskSupplyPeople)} detail="Supply records needing action" icon={AlertTriangle} accent="warn" />
                <KpiCard label="Pending EWA" value={numberFormat.format(summary.kpis.pendingEwaRequests)} detail="Approval queue" icon={ShieldCheck} accent="brand" />
              </div>
            ),
          },
          {
            id: "coverage",
            label: "Coverage Health",
            content: (
              <DashboardCard title="Coverage Health" subtitle="Feasible roles against total role demand" icon={CheckCircle2}>
                <CoverageRadial percent={feasiblePercent} label={`${summary.kpis.feasibleRoles}/${summary.kpis.totalRoles} roles`} />
              </DashboardCard>
            ),
          },
          {
            id: "balance",
            label: "Demand vs Supply",
            content: (
              <DashboardCard title="Demand vs Supply" subtitle="FTE, risk, and approval pressure in one view" icon={BarChart3}>
                <SummaryBalanceChart summary={summary} />
              </DashboardCard>
            ),
          },
        ]}
      />
    );
  }

  if (activeView === "supply") {
    return (
      <SectionTabs
        tabs={[
          {
            id: "availability",
            label: "Availability",
            content: (
              <DashboardCard title="Supply Availability" subtitle="Current availability by category" icon={Users}>
                <AvailabilityDonut rows={supply.availabilityByCategory} />
              </DashboardCard>
            ),
          },
          {
            id: "bench",
            label: "Bench Movement",
            content: (
              <DashboardCard title="Bench Movement" subtitle="Weekly available FTE and bench movement" icon={BarChart3}>
                <BenchTrendChart rows={supply.benchMovement} />
              </DashboardCard>
            ),
          },
          {
            id: "risk",
            label: "Risk Mix",
            content: (
              <DashboardCard title="Supply Risk Mix" subtitle="FTE exposure by category and risk" icon={AlertTriangle}>
                <RiskMixChart rows={supply.supplyRiskByCategory} />
              </DashboardCard>
            ),
          },
          {
            id: "discipline",
            label: "Discipline Coverage",
            content: (
              <DashboardCard title="Discipline Coverage" subtitle="Available FTE by discipline" icon={TableProperties}>
                <HorizontalBarChart
                  rows={supply.peopleByDiscipline.slice(0, 8).map((row) => ({
                    label: row.discipline,
                    value: row.availableFte,
                    detail: `${row.people} people`,
                  }))}
                />
              </DashboardCard>
            ),
          },
          {
            id: "high-risk",
            label: "High-Risk People",
            content: (
              <DashboardCard title="High-Risk Supply" subtitle="People requiring workforce action" icon={AlertTriangle}>
                <DataTable
                  headers={["Person", "Category", "FTE", "Action"]}
                  rows={supply.highRiskPeople.map((row) => [
                    <StackedText key="person" title={row.name} subtitle={`${row.discipline} - ${row.city}`} />,
                    row.availabilityCategory,
                    formatFte(row.supplyFte),
                    row.suggestedAction,
                  ])}
                />
              </DashboardCard>
            ),
          },
        ]}
      />
    );
  }

  if (activeView === "demand") {
    return (
      <SectionTabs
        tabs={[
          {
            id: "pipeline",
            label: "Pipeline",
            content: (
              <DashboardCard title="Demand Pipeline" subtitle="Opportunities, roles, FTE, and probability by stage" icon={BriefcaseBusiness}>
                <DemandPipelineChart rows={demand.demandByStage} />
              </DashboardCard>
            ),
          },
          {
            id: "roles",
            label: "Role Demand",
            content: (
              <DashboardCard title="Role Demand" subtitle="FTE demand by role" icon={TableProperties}>
                <HorizontalBarChart
                  rows={demand.demandByRole.slice(0, 10).map((row) => ({
                    label: row.roleName,
                    value: row.requiredFte,
                    detail: `${row.roles} roles`,
                  }))}
                />
              </DashboardCard>
            ),
          },
          {
            id: "risk",
            label: "Delivery Risk",
            content: (
              <DashboardCard title="Delivery Risk" subtitle="Commercial priority and delivery risk concentration" icon={AlertTriangle}>
                <RiskPriorityBoard rows={demand.deliveryRiskByPriority} />
              </DashboardCard>
            ),
          },
          {
            id: "opportunities",
            label: "Top Opportunities",
            content: (
              <DashboardCard title="Top Opportunities" subtitle="Largest demand items from the uploaded workbook" icon={BriefcaseBusiness}>
                <DataTable
                  headers={["Opportunity", "Stage", "Risk", "Roles", "FTE"]}
                  rows={demand.topOpportunities.map((row) => [
                    <StackedText key="opportunity" title={row.name} subtitle={row.clientName} />,
                    row.stage,
                    <RiskBadge key="risk" value={row.deliveryRisk} />,
                    row.roles,
                    formatFte(row.requiredFte),
                  ])}
                />
              </DashboardCard>
            ),
          },
        ]}
      />
    );
  }

  if (activeView === "staffing-fit") {
    return (
      <SectionTabs
        tabs={[
          {
            id: "distribution",
            label: "Fit Distribution",
            content: (
              <DashboardCard title="Fit Distribution" subtitle="Candidate recommendation quality" icon={Sparkles}>
                <FitDistributionChart rows={staffingFit.fitDistribution} />
              </DashboardCard>
            ),
          },
          {
            id: "scores",
            label: "Score Spread",
            content: (
              <DashboardCard title="Candidate Score Spread" subtitle="Best ranked staffing overlays by overall score" icon={Gauge}>
                <CandidateScoreChart rows={staffingFit.topCandidatePerRole.slice(0, 10)} />
              </DashboardCard>
            ),
          },
          {
            id: "candidates",
            label: "Top Candidates",
            content: (
              <DashboardCard title="Top Candidate Per Role" subtitle="Role-level candidate evidence" icon={Sparkles}>
                <DataTable
                  headers={["Role", "Candidate", "Fit", "Score", "Gap"]}
                  rows={staffingFit.topCandidatePerRole.map((row) => [
                    <StackedText key="role" title={row.roleName} subtitle={row.opportunityName} />,
                    row.personName,
                    <FitBadge key="fit" value={row.fitStatus} />,
                    Math.round(row.overallStaffingScore),
                    formatFte(row.fteGap),
                  ])}
                />
              </DashboardCard>
            ),
          },
        ]}
      />
    );
  }

  if (activeView === "skills") {
    return (
      <SectionTabs
        tabs={[
          {
            id: "gaps",
            label: "Skill Gaps",
            content: (
              <DashboardCard title="Skill Gaps" subtitle="Required skills not covered by current supply" icon={Wrench}>
                <SkillGapChart rows={skills.skillGaps.slice(0, 10)} />
              </DashboardCard>
            ),
          },
          {
            id: "supply",
            label: "Skill Supply",
            content: (
              <DashboardCard title="Skill Supply" subtitle="People with evidence by skill" icon={Users}>
                <SkillSupplyRadarLike rows={skills.skillSupply.slice(0, 7)} />
              </DashboardCard>
            ),
          },
          {
            id: "demand",
            label: "Skill Demand",
            content: (
              <DashboardCard title="Skill Demand" subtitle="Required and desired skill frequency" icon={TableProperties}>
                <DataTable
                  headers={["Skill", "Importance", "Roles"]}
                  rows={skills.requiredSkillDemand.map((row) => [row.skillName, row.importance, row.roleCount])}
                />
              </DashboardCard>
            ),
          },
        ]}
      />
    );
  }

  return (
    <SectionTabs
      tabs={[
        {
          id: "status",
          label: "Status",
          content: (
            <DashboardCard title="EWA Status" subtitle="Requests and requested FTE by status" icon={ShieldCheck}>
              <EwaStatusChart rows={ewa.ewaByStatus} />
            </DashboardCard>
          ),
        },
        {
          id: "action-required",
          label: "Action Required",
          content: (
            <DashboardCard title="Action Required" subtitle="Operational items surfaced from EWA and supply signals" icon={Sparkles}>
              <ActionCards rows={ewa.actionRequired.slice(0, 5)} />
            </DashboardCard>
          ),
        },
        {
          id: "queue",
          label: "Queue",
          content: (
            <DashboardCard title="EWA Queue" subtitle="Approval and blocking actions" icon={ShieldCheck}>
              <DataTable
                headers={["Person", "Role", "Status", "Next Action"]}
                rows={ewa.ewaQueue.map((row) => [
                  <StackedText key="person" title={row.personName} subtitle={row.opportunityName} />,
                  row.roleName,
                  <EwaBadge key="ewa" value={row.ewaStatus} />,
                  row.nextAction,
                ])}
              />
            </DashboardCard>
          ),
        },
      ]}
    />
  );
}

