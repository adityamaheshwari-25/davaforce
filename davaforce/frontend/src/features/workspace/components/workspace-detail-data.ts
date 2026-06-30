import { AlertTriangle, BriefcaseBusiness, Gauge, Users } from "lucide-react";
import type { DashboardView } from "./types";

export const dashboardMetrics = [
  { label: "People", value: "248", detail: "Normalized from Person", icon: Users },
  { label: "Available FTE", value: "63.5", detail: "Current + rolling off", icon: Gauge },
  { label: "Open Roles", value: "42", detail: "OpportunityRole demand", icon: BriefcaseBusiness },
  { label: "High Risk", value: "18", detail: "Supply and delivery risk", icon: AlertTriangle },
];

export const staffingRows = [
  { role: "Data Engineer", opportunity: "NorthBank Modernization", fit: 94, person: "Aarav Mehta", gap: "0.0 FTE" },
  { role: "QA Automation", opportunity: "Atlas Mobility", fit: 88, person: "Maya Rao", gap: "0.2 FTE" },
  { role: "UX Designer", opportunity: "Retail Studio", fit: 84, person: "Neha Iyer", gap: "0.0 FTE" },
  { role: "Solution Architect", opportunity: "Payments Core", fit: 78, person: "Rohan Nair", gap: "0.5 FTE" },
];

export const supplyRows = [
  { group: "Current Bench", people: 24, fte: 19.5, risk: "High" },
  { group: "Rolling Off 0-30", people: 31, fte: 26.0, risk: "Medium" },
  { group: "Rolling Off 31-60", people: 42, fte: 34.5, risk: "Low" },
  { group: "Partial Capacity", people: 17, fte: 8.0, risk: "Medium" },
];

export const skillRows = [
  { skill: "Azure Data Factory", required: 14, available: 8, gap: 6 },
  { skill: "Spring Boot", required: 18, available: 15, gap: 3 },
  { skill: "Playwright", required: 9, available: 4, gap: 5 },
  { skill: "Figma", required: 6, available: 7, gap: 0 },
];

export const demandRows = [
  { stage: "Qualified", opportunities: 7, roles: 16, fte: 18.5 },
  { stage: "Proposal", opportunities: 5, roles: 13, fte: 14.0 },
  { stage: "Committed", opportunities: 4, roles: 9, fte: 11.5 },
  { stage: "At Risk", opportunities: 2, roles: 4, fte: 5.0 },
];

export function chooseDetailView(prompt: string): DashboardView | null {
  const lower = prompt.toLowerCase();
  if (lower.includes("skill") || lower.includes("gap") || lower.includes("capability")) return "skill-gaps";
  if (lower.includes("bench") || lower.includes("available") || lower.includes("supply") || lower.includes("risk")) return "supply-risk";
  if (lower.includes("opportun") || lower.includes("demand") || lower.includes("role")) return "demand";
  if (lower.includes("fit") || lower.includes("candidate") || lower.includes("staff")) return "staffing-fit";
  return null;
}

export function detailViewLabel(view: DashboardView) {
  const labels: Record<DashboardView, string> = {
    overview: "Overall Dashboard",
    "staffing-fit": "Staffing Fit",
    "supply-risk": "Supply Risk",
    "skill-gaps": "Skill Gaps",
    demand: "Demand Pipeline",
  };
  return labels[view];
}
