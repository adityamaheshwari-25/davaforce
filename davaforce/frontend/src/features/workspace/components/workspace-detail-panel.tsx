import {
  Activity,
  AlertTriangle,
  BadgeCheck,
  BarChart3,
  BriefcaseBusiness,
  CalendarClock,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  CircleAlert,
  ClipboardCheck,
  FileJson2,
  Gauge,
  GitBranch,
  Layers3,
  ListChecks,
  MapPin,
  Radar,
  SearchCheck,
  ShieldAlert,
  Sparkles,
  TableProperties,
  Target,
  TrendingUp,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { WorkspaceAgentDetails, WorkspaceDetailTable } from "./types";
import {
  COLORS,
  bool,
  formatNumber,
  number,
  percent,
  record,
  records,
  riskColor,
  strings,
  text,
  type AnyRecord,
  type ChartRow,
} from "./workspace-detail-utils";

type WorkspaceDetailPanelProps = {
  sourceName: string;
  details?: WorkspaceAgentDetails | null;
};

export function WorkspaceDetailPanel({ sourceName, details }: WorkspaceDetailPanelProps) {
  return (
    <div className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--home-border)] pb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-brand/10">
              {details ? <BarChart3 className="h-4 w-4 text-brand" /> : <SearchCheck className="h-4 w-4 text-brand" />}
            </div>
            <h2 className="font-display text-xl font-semibold">{details?.title ?? "Details"}</h2>
          </div>
          <p className="mt-1 max-w-2xl truncate text-xs text-[var(--home-muted)]">
            {details ? `Source: ${sourceName}` : "Open details from an assistant response when you need the evidence view."}
          </p>
        </div>
        {details ? <AgentBadge details={details} /> : null}
      </div>

      <div className="mt-5">
        {details ? (
          <AgentDetailDashboard details={details} />
        ) : (
          <NoContractSelected />
        )}
      </div>
    </div>
  );
}

function AgentDetailDashboard({ details }: { details: WorkspaceAgentDetails }) {
  const json = details.json;
  const router = record(json.router);
  const opportunityAssessment = record(json.opportunityAssessment);
  const resourceSupply = record(json.resourceSupply);
  const teamBuilder = record(json.teamBuilder);
  const riskInsights = record(json.riskInsights);
  const approvalDecision = record(json.approvalDecision);
  const genericDatasetQuery = genericDatasetQueryContract(details);

  return (
    <div className="space-y-5">
      <AgentHero details={details} />
      {router ? <RouterPath router={router} /> : null}

      {approvalDecision ? (
        <ApprovalDashboard data={approvalDecision} />
      ) : riskInsights ? (
        <RiskDashboard data={riskInsights} />
      ) : teamBuilder ? (
        <TeamBuilderDashboard data={teamBuilder} />
      ) : resourceSupply ? (
        <ResourceSupplyDashboard data={resourceSupply} />
      ) : opportunityAssessment ? (
        <OpportunityAssessmentDashboard data={opportunityAssessment} />
      ) : genericDatasetQuery ? (
        <GenericDatasetQueryDashboard data={genericDatasetQuery} tables={details.tables} />
      ) : (
        <UnsupportedContractDashboard />
      )}

      <EvidenceAndJson details={details} />
    </div>
  );
}

function NoContractSelected() {
  return (
    <div className="rounded-xl border border-dashed border-[var(--home-border)] bg-[var(--home-soft)] px-5 py-14 text-center">
      <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-md bg-brand/10 text-brand">
        <SearchCheck className="h-5 w-5" />
      </div>
      <h3 className="mt-4 font-display text-lg font-semibold">No details selected</h3>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--home-muted)]">
        Chat answers stay focused by default. Click View details on a response to inspect charts, tables, evidence, and the raw JSON contract.
      </p>
    </div>
  );
}

function UnsupportedContractDashboard() {
  return (
    <div className="rounded-xl border border-dashed border-[var(--home-border)] bg-[var(--home-soft)] px-5 py-10 text-center">
      <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-md bg-brand/10 text-brand">
        <FileJson2 className="h-5 w-5" />
      </div>
      <h3 className="mt-4 font-display text-lg font-semibold">Unsupported contract shape</h3>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--home-muted)]">
        This response did not include one of the configured tool contract keys.
      </p>
    </div>
  );
}

function AgentHero({ details }: { details: WorkspaceAgentDetails }) {
  return (
    <section className="overflow-hidden rounded-xl border border-brand/25 bg-[linear-gradient(135deg,rgba(255,86,64,0.12),rgba(88,153,196,0.10),rgba(48,166,97,0.08))] p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase text-brand">
            <Sparkles className="h-3.5 w-3.5" />
            Tool contract response
          </div>
          <p className="mt-3 max-w-4xl text-sm leading-6 text-[var(--home-text)]">{details.summary}</p>
        </div>
        <div className="grid min-w-[18rem] grid-cols-2 gap-2">
          {details.cards.slice(0, 4).map((card) => (
            <div key={card.label} className="rounded-lg border border-white/30 bg-[var(--home-panel)]/75 p-3 shadow-sm shadow-black/5 backdrop-blur">
              <div className="text-[10px] font-medium uppercase text-[var(--home-muted)]">{card.label}</div>
              <div className="mt-1 truncate font-display text-lg font-semibold text-[var(--home-text)]">{card.value}</div>
              {card.detail ? <div className="mt-0.5 line-clamp-1 text-[10px] text-[var(--home-muted)]">{card.detail}</div> : null}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function RouterPath({ router }: { router: AnyRecord }) {
  const path = strings(router.plannedAgentPath);
  const executionPlan = records(router.executionPlan);
  const skippedAgents = strings(router.skippedAgents);

  return (
    <section className="rounded-xl border border-[var(--home-border)] bg-[var(--home-soft)] p-4">
      <SectionTitle icon={GitBranch} title="Router Path" subtitle={`${text(router.intent, "unknown")} route - ${text(router.confidence, "n/a")} confidence`} />
      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {(path.length ? path : strings(router.agentsToRun)).map((agent, index, list) => (
            <div key={`${agent}-${index}`} className="flex items-center gap-2">
              <span className="rounded-md border border-brand/25 bg-brand/10 px-2.5 py-1 text-xs font-semibold text-brand">{agent}</span>
              {index < list.length - 1 ? <span className="text-[var(--home-muted)]">/</span> : null}
            </div>
          ))}
        </div>
        <div className="rounded-lg border border-[var(--home-border)] bg-[var(--home-panel)] p-3 text-xs text-[var(--home-muted)]">
          <div className="font-semibold text-[var(--home-text)]">{text(router.executionMode, "execution mode")}</div>
          <div className="mt-1 line-clamp-3">{text(router.reason, "No router reason supplied.")}</div>
        </div>
      </div>
      {executionPlan.length ? (
        <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {executionPlan.map((step, index) => (
            <div key={`${text(step.agent)}-${index}`} className="rounded-lg border border-[var(--home-border)] bg-[var(--home-panel)] p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase text-brand">Step {number(step.order, index + 1)}</span>
                <span className="text-[10px] text-[var(--home-muted)]">{strings(step.dependsOn).length ? "has dependency" : "start"}</span>
              </div>
              <div className="mt-1 font-display text-sm font-semibold">{text(step.agent, "Tool")}</div>
              <div className="mt-1 line-clamp-2 text-xs text-[var(--home-muted)]">{text(step.purpose, "No purpose supplied.")}</div>
            </div>
          ))}
        </div>
      ) : null}
      {skippedAgents.length ? <p className="mt-3 text-xs text-[var(--home-muted)]">Skipped: {skippedAgents.join(", ")}</p> : null}
    </section>
  );
}

function OpportunityAssessmentDashboard({ data }: { data: AnyRecord }) {
  const opportunity = record(data.opportunity);
  const diagnostics = record(data.selectionDiagnostics);
  const roles = records(data.roles);
  const normalized = record(data.normalizedRequirements);
  const signals = record(data.extractedQuerySignals);
  const candidateOpportunities = records(diagnostics?.candidateOpportunities);
  const roleDemand = roles.map((role) => ({
    label: text(role.roleName, "Role"),
    value: number(role.fteRequired),
    color: text(role.priority).toLowerCase() === "high" ? COLORS.brand : COLORS.blue,
  }));

  return (
    <div className="space-y-5">
      <MetricGrid
        items={[
          { icon: BriefcaseBusiness, label: "Selected Opportunity", value: opportunity ? text(opportunity.name) : text(data.selectedOpportunityId, "Not selected"), detail: text(data.selectionReason) },
          { icon: TrendingUp, label: "Probability", value: opportunity ? percent(opportunity.probability) : "n/a", detail: opportunity ? `${text(opportunity.stage)} stage` : undefined },
          { icon: Users, label: "Required FTE", value: formatNumber(number(normalized?.totalFteRequired)), detail: `${roles.length} role(s)` },
          { icon: CalendarClock, label: "Start Window", value: text(normalized?.startDate, text(opportunity?.expectedStartDate, "n/a")), detail: `${number(normalized?.durationWeeks, number(opportunity?.durationWeeks))} weeks` },
        ]}
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <ChartPanel title="Role Demand" subtitle="FTE required by role" data={roleDemand} />
        <InfoPanel
          icon={Target}
          title="Normalized Requirements"
          rows={[
            ["Roles", strings(normalized?.requiredRoles).join(", ") || "n/a"],
            ["Required skills", strings(normalized?.requiredSkills).slice(0, 8).join(", ") || "n/a"],
            ["Desired skills", strings(normalized?.desiredSkills).slice(0, 8).join(", ") || "n/a"],
            ["Locations", strings(normalized?.locations).join(", ") || "n/a"],
            ["Query signals", [...strings(signals?.skills), ...strings(signals?.roleHints)].slice(0, 8).join(", ") || "n/a"],
          ]}
        />
      </div>

      <DataTable
        title="Required Roles"
        headers={["Role", "FTE", "Grade", "Priority", "Skills", "Split"]}
        rows={roles.map((role) => [
          text(role.roleName),
          formatNumber(number(role.fteRequired)),
          text(role.gradePreference, "n/a"),
          text(role.priority, "n/a"),
          strings(role.requiredSkills).slice(0, 5).join(", "),
          bool(role.canCombineCandidates) ? "Can combine" : "Single candidate",
        ])}
      />

      {candidateOpportunities.length ? (
        <DataTable
          title="Selection Candidates"
          headers={["Opportunity", "Client", "Stage", "Probability", "Score", "Reason"]}
          rows={candidateOpportunities.map((item) => [
            text(item.name),
            text(item.clientName),
            text(item.stage),
            percent(item.probability),
            formatNumber(number(item.selectionScore)),
            text(item.selectionReason),
          ])}
        />
      ) : null}
    </div>
  );
}

function ResourceSupplyDashboard({ data }: { data: AnyRecord }) {
  const filters = record(data.filters);
  const summary = record(data.summary);
  const candidates = records(data.candidates);
  const nearMatches = records(data.nearMatches);
  const diagnostics = record(data.filterDiagnostics);
  const capacity = records(data.capacityByWindow);
  const capacityRows = capacity.map((item) => ({
    label: text(item.window, "Window"),
    value: number(item.fte),
    color: text(item.window).toLowerCase().includes("current") ? COLORS.green : COLORS.blue,
  }));

  return (
    <div className="space-y-5">
      <MetricGrid
        items={[
          { icon: Users, label: "Strict Candidates", value: String(number(summary?.totalCandidates)), detail: `${nearMatches.length} near match(es)` },
          { icon: Gauge, label: "Available Now", value: `${formatNumber(number(summary?.availableNowFte))} FTE`, detail: `${number(summary?.currentBenchPeople)} bench people` },
          { icon: Activity, label: "In Window", value: `${formatNumber(number(summary?.availableInWindowFte))} FTE`, detail: `${number(summary?.partialCapacityPeople)} partial capacity` },
          { icon: CalendarClock, label: "Search Window", value: `${number(filters?.availabilityWindowDays)} days`, detail: text(filters?.asOfDate, "n/a") },
        ]}
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <ChartPanel title="Capacity by Window" subtitle="FTE returned by release window" data={capacityRows} />
        <FilterDiagnostics diagnostics={diagnostics} />
      </div>

      <CandidateShowcase candidates={candidates} title="Top Strict Matches" />

      <DataTable
        title="Candidate Evidence"
        headers={["Person", "Discipline", "Location", "Available FTE", "Skill Score", "EWA", "Evidence"]}
        rows={candidates.slice(0, 12).map((candidate) => [
          text(candidate.name),
          text(candidate.discipline),
          [text(candidate.city), text(candidate.country)].filter(Boolean).join(", "),
          formatNumber(number(candidate.availableFteInWindow)),
          formatNumber(number(candidate.skillMatchScore)),
          text(candidate.ewaStatus),
          strings(candidate.evidence)[0] ?? "",
        ])}
      />

      {nearMatches.length ? (
        <DataTable
          title="Near Matches from Relaxed Filters"
          headers={["Person", "Role", "Available FTE", "Fit", "Skills", "Reason"]}
          rows={nearMatches.slice(0, 10).map((candidate) => [
            text(candidate.name),
            text(candidate.roleArchetype),
            formatNumber(number(candidate.availableFteInWindow)),
            text(candidate.fitStatus, "near-match"),
            strings(candidate.matchedSkills).slice(0, 4).join(", "),
            strings(candidate.evidence)[0] ?? "",
          ])}
        />
      ) : null}
    </div>
  );
}

function TeamBuilderDashboard({ data }: { data: AnyRecord }) {
  const opportunity = record(data.opportunity);
  const roleWiseCandidates = records(data.roleWiseCandidates);
  const teamOptions = records(data.teamOptions);
  const balanced = teamOptions.find((option) => text(option.optionType) === "Balanced Team") ?? teamOptions[0];
  const optionRows = teamOptions.map((option) => ({
    label: text(option.optionType).replace(" Team", ""),
    value: number(option.assignedFte),
    color: number(option.remainingFteGap) > 0 ? COLORS.amber : COLORS.green,
  }));

  return (
    <div className="space-y-5">
      <MetricGrid
        items={[
          { icon: BriefcaseBusiness, label: "Opportunity", value: text(opportunity?.name, "Selected opportunity"), detail: opportunity ? `${text(opportunity.domain)}, ${text(opportunity.country)}` : undefined },
          { icon: Layers3, label: "Team Options", value: String(teamOptions.length), detail: teamOptions.map((option) => text(option.confidence)).filter(Boolean).join(" / ") },
          { icon: Users, label: "Assigned FTE", value: formatNumber(number(balanced?.assignedFte)), detail: `${formatNumber(number(balanced?.totalFteRequired))} required` },
          { icon: AlertTriangle, label: "Remaining Gap", value: formatNumber(number(balanced?.remainingFteGap)), detail: strings(balanced?.gaps)[0] ?? "No gap noted" },
        ]}
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <ChartPanel title="Team Option Coverage" subtitle="Assigned FTE by recommended option" data={optionRows} />
        <div className="space-y-3">
          {teamOptions.map((option) => (
            <TeamOptionCard key={text(option.optionType)} option={option} />
          ))}
        </div>
      </div>

      <DataTable
        title="Selected Team Assignments"
        headers={["Role", "Person", "FTE", "Feasibility", "Score", "Evidence"]}
        rows={records(balanced?.assignments).map((assignment) => [
          text(assignment.roleName),
          text(assignment.name),
          formatNumber(number(assignment.assignmentFte)),
          text(assignment.feasibility),
          formatNumber(number(assignment.overallScore)),
          strings(assignment.evidence)[0] ?? "",
        ])}
      />

      <RoleCandidateGrid roles={roleWiseCandidates} />
    </div>
  );
}

function RiskDashboard({ data }: { data: AnyRecord }) {
  const opportunity = record(data.opportunity);
  const optionAnalyses = records(data.optionAnalyses);
  const roleAnalyses = records(data.roleAnalyses);
  const capabilityGaps = records(data.capabilityGaps);
  const availabilityRisks = records(data.availabilityRisks);
  const regionalImpact = records(data.regionalCapacityImpact);
  const utilizationImpact = records(data.utilizationImpact);
  const optionRiskRows = optionAnalyses.map((option) => ({
    label: text(option.optionType).replace(" Team", ""),
    value: number(option.riskScore),
    color: riskColor(text(option.riskLevel)),
  }));

  return (
    <div className="space-y-5">
      <MetricGrid
        items={[
          { icon: BriefcaseBusiness, label: "Opportunity", value: text(opportunity?.name, "Selected opportunity"), detail: opportunity ? `${text(opportunity.stage)} / ${text(opportunity.deliveryRisk)}` : undefined },
          { icon: ShieldAlert, label: "Overall Risk", value: text(data.overallRiskLevel, "n/a"), detail: `${text(data.overallConfidence, "n/a")} confidence` },
          { icon: CircleAlert, label: "Capability Gaps", value: String(capabilityGaps.length), detail: text(capabilityGaps[0]?.message, "No capability gap called out") },
          { icon: CalendarClock, label: "Availability Risks", value: String(availabilityRisks.length), detail: text(availabilityRisks[0]?.message, "No availability risk called out") },
        ]}
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <ChartPanel title="Option Risk Score" subtitle="Higher scores indicate more staffing risk" data={optionRiskRows} />
        <ActionPanel title="Recommended Next Actions" items={strings(data.nextActions)} icon={ListChecks} />
      </div>

      <RiskCards title="Capability and Availability Risks" items={[...capabilityGaps, ...availabilityRisks]} />

      <DataTable
        title="Option Risk Analysis"
        headers={["Option", "Risk", "Confidence", "Assigned FTE", "Gap", "Action"]}
        rows={optionAnalyses.map((option) => [
          text(option.optionType),
          text(option.riskLevel),
          text(option.confidence),
          formatNumber(number(option.assignedFte)),
          formatNumber(number(option.remainingFteGap)),
          strings(option.recommendedActions)[0] ?? "",
        ])}
      />

      <DataTable
        title="Role Risk Analysis"
        headers={["Role", "Risk", "Best Candidate", "Capability", "Availability", "Next Action"]}
        rows={roleAnalyses.map((role) => [
          text(role.roleName),
          text(role.riskLevel),
          text(role.bestCandidate, "n/a"),
          text(role.capabilityGapSummary),
          text(role.availabilityRiskSummary),
          strings(role.nextActions)[0] ?? "",
        ])}
      />

      <div className="grid gap-4 md:grid-cols-2">
        <ImpactPanel title="Regional Capacity Impact" items={regionalImpact} />
        <ImpactPanel title="Utilization Impact" items={utilizationImpact} />
      </div>
    </div>
  );
}

function ApprovalDashboard({ data }: { data: AnyRecord }) {
  const opportunity = record(data.opportunity);
  const selectedOption = record(data.selectedOption);
  const riskSummary = record(data.riskSummary);
  const ewaSummary = record(data.ewaSummary);
  const approvalPackage = record(data.approvalPackage);
  const checklist = records(data.approvalChecklist);
  const blockers = records(ewaSummary?.blockers);
  const statusRows = Object.entries(record(ewaSummary?.requestsByStatus) ?? {}).map(([label, value]) => ({
    label,
    value: number(value),
    color: label.toLowerCase().includes("blocked") ? COLORS.brand : COLORS.blue,
  }));

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-[var(--home-border)] bg-[var(--home-soft)] p-4">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div>
            <div className="flex items-center gap-2">
              <StatusPill value={text(data.decisionState, "No recommendation")} />
              <span className="text-xs text-[var(--home-muted)]">{bool(data.humanApprovalRequired) ? "Human review required" : "No human review flag"}</span>
            </div>
            <h3 className="mt-3 font-display text-2xl font-semibold">{text(opportunity?.name, "Approval Package")}</h3>
            <p className="mt-2 text-sm leading-6 text-[var(--home-muted)]">{text(data.recommendationSummary, "No recommendation summary supplied.")}</p>
          </div>
          <div className="rounded-lg border border-[var(--home-border)] bg-[var(--home-panel)] p-3">
            <div className="text-xs text-[var(--home-muted)]">Recommended decision</div>
            <div className="mt-2 text-sm font-semibold">{text(approvalPackage?.recommendedDecision, text(data.decisionState))}</div>
            <div className="mt-3 text-xs text-[var(--home-muted)]">{text(approvalPackage?.decisionPrompt, "Review the package before approval.")}</div>
          </div>
        </div>
      </section>

      <MetricGrid
        items={[
          { icon: BadgeCheck, label: "Ready for Review", value: bool(data.readyForApproval) ? "Yes" : "No", detail: text(data.selectedOptionType, "No option selected") },
          { icon: ShieldAlert, label: "Overall Risk", value: text(riskSummary?.overallRiskLevel, "n/a"), detail: `${text(riskSummary?.overallConfidence, "n/a")} confidence` },
          { icon: FileJson2, label: "EWA Requests", value: String(number(ewaSummary?.totalRequests)), detail: `${blockers.length} blocker(s)` },
          { icon: ClipboardCheck, label: "Checklist Items", value: String(checklist.length), detail: `${checklist.filter((item) => text(item.status) === "Pass").length} pass` },
        ]}
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <ChartPanel title="EWA Requests by Status" subtitle="Status summary for selected option" data={statusRows} />
        <ActionPanel title="Approval Conditions" items={strings(approvalPackage?.conditions)} icon={ClipboardCheck} />
      </div>

      <DataTable
        title="Approval Checklist"
        headers={["Item", "Status", "Notes"]}
        rows={checklist.map((item) => [text(item.item), text(item.status), strings(item.notes).join("; ")])}
      />

      <DataTable
        title="Selected Option Assignments"
        headers={["Role", "Person", "FTE", "Feasibility", "Score"]}
        rows={records(selectedOption?.assignments).map((assignment) => [
          text(assignment.roleName),
          text(assignment.name),
          formatNumber(number(assignment.assignmentFte)),
          text(assignment.feasibility),
          formatNumber(number(assignment.overallScore)),
        ])}
      />

      {blockers.length ? (
        <DataTable
          title="EWA Blockers"
          headers={["Role", "Person", "Status", "FTE", "Blocking Reason", "Next Action"]}
          rows={blockers.map((blocker) => [
            text(blocker.roleName),
            text(blocker.personName),
            text(blocker.ewaStatus),
            formatNumber(number(blocker.requestedFte)),
            text(blocker.blockingReason),
            text(blocker.nextAction),
          ])}
        />
      ) : null}
    </div>
  );
}

function AgentBadge({ details }: { details: WorkspaceAgentDetails }) {
  const json = details.json;
  const label = json.approvalDecision
    ? "Approval"
    : json.riskInsights
      ? "Risk"
      : json.teamBuilder
        ? "Team"
        : json.resourceSupply
          ? "Supply"
          : json.opportunityAssessment
            ? "Demand"
            : genericDatasetQueryContract(details)
              ? "Query"
              : "Tool";

  return (
    <span className="rounded-full border border-brand/25 bg-brand/10 px-3 py-1 text-xs font-semibold text-brand">
      {label} JSON
    </span>
  );
}

function genericDatasetQueryContract(details: WorkspaceAgentDetails) {
  const json = details.json;
  const explicit = record(json.genericDatasetQuery);
  if (explicit) return explicit;

  if (text(json.queryType) && text(json.tableName)) {
    return json;
  }

  if (details.view !== "table-query") return null;

  const firstTable = details.tables[0];
  const tableCard = details.cards.find((card) => /^(table|sheet)$/i.test(card.label));
  const rowsCard = details.cards.find((card) => /^rows$/i.test(card.label));
  const queryTypeCard = details.cards.find((card) => /^query type$/i.test(card.label));
  const filterCard = details.cards.find((card) => /^filters$/i.test(card.label));

  return {
    query: details.summary,
    queryType: queryTypeCard?.value || "list",
    tableName: tableCard?.detail || tableCard?.value || "Dataset",
    tableDisplayName: tableCard?.value || tableCard?.detail || "Dataset",
    confidence: queryTypeCard?.detail || "n/a",
    filters: filterCard?.detail && filterCard.detail !== "No filters" ? [filterCard.detail] : [],
    totalMatchingRows: number(rowsCard?.value, firstTable?.rows.length ?? 0),
    returnedRows: firstTable?.rows.length ?? 0,
    headers: firstTable?.headers ?? [],
    rows: firstTable?.rows ?? [],
  };
}

function GenericDatasetQueryDashboard({ data, tables }: { data: AnyRecord; tables: WorkspaceDetailTable[] }) {
  const filterRecords = records(data.filters);
  const filterTerms = filterRecords.length
    ? filterRecords.map((filter) => text(filter.term)).filter(Boolean)
    : strings(data.filters);
  const groupBy = record(data.groupBy);
  const queryType = text(data.queryType, "list").replace("_", " ");
  const resultTables = tables.length
    ? tables
    : [
        {
          title: "Query Results",
          headers: strings(data.headers),
          rows: Array.isArray(data.rows) ? (data.rows as string[][]) : [],
        },
      ];

  return (
    <div className="space-y-5">
      <MetricGrid
        items={[
          {
            icon: TableProperties,
            label: "Table",
            value: text(data.tableDisplayName, text(data.tableName, "Dataset")),
            detail: text(data.tableName),
          },
          {
            icon: SearchCheck,
            label: "Rows",
            value: formatNumber(number(data.totalMatchingRows)),
            detail: `${formatNumber(number(data.returnedRows))} returned`,
          },
          {
            icon: FileJson2,
            label: "Query Type",
            value: queryType,
            detail: text(data.confidence, "n/a"),
          },
          {
            icon: ListChecks,
            label: "Filters",
            value: filterTerms.length ? String(filterTerms.length) : "0",
            detail: filterTerms.join(", ") || "No filters",
          },
        ]}
      />
      <InfoPanel
        icon={ClipboardCheck}
        title="Query Plan"
        rows={[
          ["Question", text(data.query, "n/a")],
          ["Read Mode", "SELECT only"],
          ["Group By", groupBy ? text(groupBy.displayName, text(groupBy.columnName)) : text(data.groupBy, "None")],
          ["Filters", filterTerms.join(", ") || "None"],
        ]}
      />
      {resultTables.map((table) => (
        <DataTable key={table.title} title={table.title} headers={table.headers} rows={table.rows} />
      ))}
    </div>
  );
}

function MetricGrid({ items }: { items: Array<{ icon: LucideIcon; label: string; value: string; detail?: string }> }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <div key={item.label} className="rounded-xl border border-[var(--home-border)] bg-[var(--home-soft)] p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-[var(--home-muted)]">{item.label}</span>
              <Icon className="h-4 w-4 text-brand" />
            </div>
            <div className="mt-2 line-clamp-2 font-display text-2xl font-semibold">{item.value}</div>
            {item.detail ? <div className="mt-1 line-clamp-2 text-[11px] text-[var(--home-muted)]">{item.detail}</div> : null}
          </div>
        );
      })}
    </div>
  );
}

function ChartPanel({ title, subtitle, data }: { title: string; subtitle: string; data: ChartRow[] }) {
  return (
    <div className="rounded-xl border border-[var(--home-border)] bg-[var(--home-soft)] p-4">
      <SectionTitle icon={BarChart3} title={title} subtitle={subtitle} />
      <div className="mt-4 h-[300px] 2xl:h-[380px]">
        {data.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 84, bottom: 0 }}>
              <CartesianGrid stroke="rgba(127,127,127,0.14)" horizontal={false} />
              <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: "currentColor", fontSize: 11 }} />
              <YAxis type="category" dataKey="label" width={104} axisLine={false} tickLine={false} tick={{ fill: "currentColor", fontSize: 10 }} />
              <Tooltip cursor={false} content={<WorkspaceChartTooltip />} />
              <Bar dataKey="value" radius={[0, 10, 10, 0]} fillOpacity={0.9} activeBar={{ stroke: COLORS.brand, strokeWidth: 3, fillOpacity: 1 }}>
                {data.map((row) => (
                  <Cell key={row.label} fill={row.color ?? COLORS.brand} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <EmptyState text="No chart rows returned for this response." />
        )}
      </div>
    </div>
  );
}

function CandidateShowcase({ candidates, title }: { candidates: AnyRecord[]; title: string }) {
  return (
    <section className="space-y-3">
      <SectionTitle icon={SearchCheck} title={title} subtitle="Ranked people evidence from the resource supply contract" />
      <div className="grid gap-3 lg:grid-cols-3">
        {candidates.slice(0, 3).map((candidate, index) => (
          <div key={`${text(candidate.personId)}-${index}`} className="rounded-xl border border-[var(--home-border)] bg-[var(--home-soft)] p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate font-display text-base font-semibold">{text(candidate.name)}</div>
                <div className="mt-1 truncate text-xs text-[var(--home-muted)]">{text(candidate.discipline)} / {text(candidate.grade)}</div>
              </div>
              <StatusPill value={text(candidate.feasibility, text(candidate.fitStatus, "match"))} />
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              <TinyMetric label="FTE" value={formatNumber(number(candidate.availableFteInWindow))} />
              <TinyMetric label="Skills" value={formatNumber(number(candidate.skillMatchScore))} />
              <TinyMetric label="Rank" value={formatNumber(number(candidate.overlayRank, index + 1))} />
            </div>
            <div className="mt-3 line-clamp-2 text-xs leading-5 text-[var(--home-muted)]">{strings(candidate.evidence)[0] ?? "Evidence unavailable."}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function FilterDiagnostics({ diagnostics }: { diagnostics?: AnyRecord | null }) {
  const rows: Array<[string, number]> = [
    ["Evaluated", number(diagnostics?.evaluated)],
    ["Availability", number(diagnostics?.afterAvailability)],
    ["Skills / overlay", number(diagnostics?.afterSkillsOrOverlay)],
    ["Location", number(diagnostics?.afterLocation)],
    ["Domain", number(diagnostics?.afterDomain)],
    ["Grade", number(diagnostics?.afterGrade)],
    ["Discipline", number(diagnostics?.afterDiscipline)],
    ["Strict", number(diagnostics?.strictMatches)],
  ];
  const max = Math.max(...rows.map(([, value]) => value), 1);

  return (
    <div className="rounded-xl border border-[var(--home-border)] bg-[var(--home-soft)] p-4">
      <SectionTitle icon={Radar} title="Filter Diagnostics" subtitle="Candidate pool after each deterministic filter" />
      <div className="mt-4 space-y-3">
        {rows.map(([label, value]) => (
          <div key={label}>
            <div className="flex justify-between text-xs">
              <span className="text-[var(--home-muted)]">{label}</span>
              <span className="font-semibold">{value}</span>
            </div>
            <div className="mt-1 h-2 rounded-full bg-[var(--home-border)]/45">
              <div className="h-2 rounded-full bg-brand" style={{ width: `${Math.max(4, (value / max) * 100)}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TeamOptionCard({ option }: { option: AnyRecord }) {
  const remainingGap = number(option.remainingFteGap);

  return (
    <div className="rounded-xl border border-[var(--home-border)] bg-[var(--home-soft)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-display text-base font-semibold">{text(option.optionType)}</div>
          <div className="mt-1 line-clamp-2 text-xs text-[var(--home-muted)]">{text(option.summary)}</div>
        </div>
        <StatusPill value={text(option.confidence, "n/a")} />
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2">
        <TinyMetric label="Assigned" value={formatNumber(number(option.assignedFte))} />
        <TinyMetric label="Gap" value={formatNumber(remainingGap)} />
        <TinyMetric label="Score" value={formatNumber(number(option.averageOverallScore))} />
      </div>
    </div>
  );
}

function RoleCandidateGrid({ roles }: { roles: AnyRecord[] }) {
  return (
    <section className="space-y-3">
      <SectionTitle icon={Users} title="Role Candidate Pools" subtitle="Candidate counts, FTE need, and role outcomes" />
      <div className="grid gap-3 lg:grid-cols-2">
        {roles.map((role) => {
          const candidates = records(role.candidates);
          const topCandidate = candidates[0];
          return (
            <div key={text(role.roleId, text(role.roleName))} className="rounded-xl border border-[var(--home-border)] bg-[var(--home-soft)] p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-display text-base font-semibold">{text(role.roleName)}</div>
                  <div className="mt-1 text-xs text-[var(--home-muted)]">{formatNumber(number(role.fteRequired))} FTE required / {candidates.length} candidates</div>
                </div>
                <StatusPill value={bool(role.canCombineCandidates) ? "Can split" : "Single"} />
              </div>
              <div className="mt-3 rounded-lg border border-[var(--home-border)] bg-[var(--home-panel)] p-3 text-xs">
                <div className="font-semibold">{topCandidate ? text(topCandidate.name) : "No candidate"}</div>
                <div className="mt-1 text-[var(--home-muted)]">{text(role.outcome, "No outcome returned.")}</div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function RiskCards({ title, items }: { title: string; items: AnyRecord[] }) {
  return (
    <section className="space-y-3">
      <SectionTitle icon={AlertTriangle} title={title} subtitle="Evidence-backed risk items returned by the tool" />
      {items.length ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {items.slice(0, 8).map((item, index) => (
            <div key={`${text(item.category)}-${index}`} className="rounded-xl border border-[var(--home-border)] bg-[var(--home-soft)] p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase text-[var(--home-muted)]">{text(item.category, "Risk")}</span>
                <StatusPill value={text(item.severity, "n/a")} />
              </div>
              <div className="mt-2 text-sm font-semibold">{text(item.scope, "Scope unavailable")}</div>
              <p className="mt-1 text-xs leading-5 text-[var(--home-muted)]">{text(item.message, "No message returned.")}</p>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState text="No risk items returned." />
      )}
    </section>
  );
}

function ImpactPanel({ title, items }: { title: string; items: AnyRecord[] }) {
  return (
    <div className="rounded-xl border border-[var(--home-border)] bg-[var(--home-soft)] p-4">
      <SectionTitle icon={MapPin} title={title} subtitle="FTE and people impact from the selected option" />
      <div className="mt-4 space-y-3">
        {items.length ? items.map((item) => (
          <div key={text(item.label)} className="rounded-lg border border-[var(--home-border)] bg-[var(--home-panel)] p-3">
            <div className="flex justify-between gap-3">
              <span className="font-semibold">{text(item.label)}</span>
              <span className="text-xs text-[var(--home-muted)]">{formatNumber(number(item.assignedFte))} FTE / {number(item.people)} people</span>
            </div>
            <div className="mt-1 text-xs text-[var(--home-muted)]">{strings(item.notes)[0] ?? "No note supplied."}</div>
          </div>
        )) : <EmptyState text="No impact rows returned." />}
      </div>
    </div>
  );
}

function ActionPanel({ title, items, icon: Icon }: { title: string; items: string[]; icon: LucideIcon }) {
  return (
    <div className="rounded-xl border border-[var(--home-border)] bg-[var(--home-soft)] p-4">
      <SectionTitle icon={Icon} title={title} subtitle="Next human actions from the tool output" />
      <div className="mt-4 space-y-2">
        {items.length ? items.map((item, index) => (
          <div key={`${item}-${index}`} className="flex gap-2 rounded-lg border border-[var(--home-border)] bg-[var(--home-panel)] p-3 text-sm">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
            <span className="leading-5">{item}</span>
          </div>
        )) : <EmptyState text="No action items returned." />}
      </div>
    </div>
  );
}

function InfoPanel({ icon: Icon, title, rows }: { icon: LucideIcon; title: string; rows: string[][] }) {
  return (
    <div className="rounded-xl border border-[var(--home-border)] bg-[var(--home-soft)] p-4">
      <SectionTitle icon={Icon} title={title} subtitle="Structured fields from the tool contract" />
      <div className="mt-4 divide-y divide-[var(--home-border)] rounded-lg border border-[var(--home-border)] bg-[var(--home-panel)]">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[8rem_minmax(0,1fr)] gap-3 px-3 py-2 text-xs">
            <span className="text-[var(--home-muted)]">{label}</span>
            <span className="min-w-0 truncate font-medium">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function EvidenceAndJson({ details }: { details: WorkspaceAgentDetails }) {
  const evidence = strings(details.json.evidence);

  return (
    <section className="space-y-4">
      <div className="rounded-xl border border-[var(--home-border)] bg-[var(--home-soft)] p-4">
        <SectionTitle icon={ListChecks} title="Evidence" subtitle="Guardrails and evidence snippets" />
        <div className="mt-4 space-y-2">
          {evidence.length ? evidence.slice(0, 8).map((item, index) => (
            <div key={`${item}-${index}`} className="rounded-lg border border-[var(--home-border)] bg-[var(--home-panel)] p-3 text-xs leading-5 text-[var(--home-muted)] break-words">
              {item}
            </div>
          )) : <EmptyState text="No evidence array returned." />}
        </div>
      </div>
      <details className="group rounded-xl border border-[var(--home-border)] bg-[var(--home-soft)] p-4">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
          <SectionTitle icon={FileJson2} title="Raw JSON Contract" subtitle="Stored with this chat message for auditability" />
          <ChevronDown className="h-5 w-5 shrink-0 text-brand transition-transform duration-200 group-open:rotate-180" />
        </summary>
        <pre className="smooth-chat-scroll mt-4 h-72 overflow-x-hidden overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-[var(--home-border)] bg-[var(--home-panel-strong)] p-3 text-[11px] leading-5 text-[var(--home-muted)] 2xl:h-96">
          {JSON.stringify(details.json, null, 2)}
        </pre>
      </details>
    </section>
  );
}

function WorkspaceChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value?: number | string; color?: string }>;
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-xl border border-[var(--home-border)] bg-[var(--home-panel-strong)] px-3 py-2 text-xs shadow-2xl shadow-black/20">
      <div className="font-semibold text-[var(--home-text)]">{label}</div>
      <div className="mt-1 flex items-center gap-2 text-[var(--home-muted)]">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: payload[0]?.color ?? COLORS.brand }} />
        <span>{payload[0]?.value}</span>
      </div>
    </div>
  );
}

function SectionTitle({ icon: Icon, title, subtitle }: { icon: LucideIcon; title: string; subtitle: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand/10">
        <Icon className="h-4 w-4 text-brand" />
      </div>
      <div className="min-w-0">
        <h3 className="font-display text-base font-semibold">{title}</h3>
        <p className="truncate text-xs text-[var(--home-muted)]">{subtitle}</p>
      </div>
    </div>
  );
}

const DETAIL_TABLE_PAGE_SIZE = 10;

function DataTable({ title, headers, rows }: { title: string; headers: string[]; rows: string[][] }) {
  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(rows.length / DETAIL_TABLE_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const startIndex = currentPage * DETAIL_TABLE_PAGE_SIZE;
  const pageRows = rows.slice(startIndex, startIndex + DETAIL_TABLE_PAGE_SIZE);
  const endIndex = rows.length ? startIndex + pageRows.length : 0;
  const columnCount = rows.reduce((count, row) => Math.max(count, row.length), Math.max(headers.length, 1));
  const tableMinWidth = columnCount > 4 ? `${Math.max(52, columnCount * 11)}rem` : "100%";
  const showPagination = rows.length > DETAIL_TABLE_PAGE_SIZE;
  const columns = Array.from({ length: columnCount }, (_, index) => headers[index] || `Column ${index + 1}`);

  return (
    <div className="space-y-3">
      <SectionTitle
        icon={TableProperties}
        title={title}
        subtitle={
          rows.length
            ? `${startIndex + 1}-${endIndex} of ${rows.length} row(s)`
            : "0 row(s) returned with this response"
        }
      />
      <div className="max-w-full overflow-hidden rounded-xl border border-[var(--home-border)]">
        <div className="smooth-chat-scroll max-w-full overflow-x-auto">
          <table className="min-w-full border-collapse text-left text-sm" style={{ minWidth: tableMinWidth }}>
            <thead className="bg-[var(--home-soft)] text-xs text-[var(--home-muted)]">
              <tr>
                {columns.map((header, index) => (
                  <th key={`${title}-header-${index}`} className="min-w-40 px-4 py-3 font-medium">
                    <span className="block max-w-64 truncate">{header}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length ? pageRows.map((row, rowIndex) => (
                <tr key={`${title}-${startIndex + rowIndex}`} className="border-t border-[var(--home-border)]">
                  {columns.map((_, index) => (
                    <td key={`${title}-${startIndex + rowIndex}-${index}`} className="min-w-40 px-4 py-3 align-top text-[var(--home-text)]">
                      <span className="line-clamp-3 max-w-64 break-words">{row[index] ?? ""}</span>
                    </td>
                  ))}
                </tr>
              )) : (
                <tr className="border-t border-[var(--home-border)]">
                  <td className="px-4 py-6 text-center text-sm text-[var(--home-muted)]" colSpan={columnCount}>
                    No rows returned.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {showPagination ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--home-border)] bg-[var(--home-panel)] px-3 py-2 text-xs text-[var(--home-muted)]">
            <span>
              Page {currentPage + 1} of {totalPages}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--home-border)] bg-[var(--home-panel-strong)] text-[var(--home-text)] disabled:cursor-not-allowed disabled:opacity-40"
                onClick={() => setPage((value) => Math.max(0, value - 1))}
                disabled={currentPage === 0}
                aria-label="Previous page"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--home-border)] bg-[var(--home-panel-strong)] text-[var(--home-text)] disabled:cursor-not-allowed disabled:opacity-40"
                onClick={() => setPage((value) => Math.min(totalPages - 1, value + 1))}
                disabled={currentPage >= totalPages - 1}
                aria-label="Next page"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function TinyMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-display text-xl font-semibold">{value}</div>
      <div className="text-[11px] text-[var(--home-muted)]">{label}</div>
    </div>
  );
}

function StatusPill({ value }: { value: string }) {
  const lowered = value.toLowerCase();
  const className =
    lowered.includes("high") || lowered.includes("block") || lowered.includes("no") || lowered.includes("review")
      ? "border-brand/30 bg-brand/10 text-brand"
      : lowered.includes("medium") || lowered.includes("partial") || lowered.includes("needs")
        ? "border-yellow-500/30 bg-yellow-500/15 text-yellow-600 dark:text-yellow-400"
        : "border-emerald-500/30 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400";

  return <span className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-semibold ${className}`}>{value}</span>;
}

function EmptyState({ text: content }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-[var(--home-border)] bg-[var(--home-panel)] px-4 py-8 text-center text-sm text-[var(--home-muted)]">
      {content}
    </div>
  );
}
