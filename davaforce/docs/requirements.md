# Requirements Document

# DavaForce

Version: 1.0

---

# 1. Overview

DavaForce is an AI-assisted workforce planning product that helps planners turn opportunity demand into evidence-backed staffing recommendations. It uses employee, skill, allocation, bench, availability, project history, and opportunity data to identify suitable candidates and to explain why they fit.

The product is designed for planners and delivery leaders who need to evaluate staffing demand against current and upcoming supply. It keeps human approval, including EWA review, in the decision loop so recommendations can inform rather than replace planner judgment.

The MVP is grounded in the validated synthetic dataset included with the project. That dataset contains 500 employees, 30 current bench records, 40 partial-capacity records, weekly availability data, opportunity demand, candidate overlays, EWA requests, and scenario targets for staffing decisions.

# 2. Problem Statement

Workforce planners often need to assemble teams from fragmented sources of truth: employee profiles, skills inventories, allocation records, bench lists, and opportunity demand. This makes it hard to answer three questions quickly and consistently:

1. Who is available now or soon?
2. Which candidates best match the role and domain requirements?
3. What staffing option is feasible when availability and approval constraints are considered?

The result is slower planning, inconsistent candidate selection, and weaker explanation quality when recommendations must be reviewed by humans.

# 3. Objectives

- Enable planners to define opportunity demand in a structured way.
- Analyze workforce supply across current bench, partial capacity, and upcoming availability windows.
- Recommend one or more staffing options for each opportunity role.
- Explain why each candidate or team option was selected.
- Surface risks, gaps, and approval blockers before a recommendation is submitted.
- Preserve EWA and human approval as the final decision gate.

# 4. Target Users

Primary users:

- Workforce planners
- Delivery managers
- Regional leaders
- Sales or client partners who need staffing options for opportunities

Secondary users:

- Approvers handling EWA review
- Operations analysts reviewing workforce supply and bench pressure

# 5. User Inputs

| Input | Description |
| --- | --- |
| Opportunity details | Client, domain, region, country, city, stage, probability, start date, duration, and timezone preference. |
| Role demand | Required role name, discipline or department, grade preference, required skills, desired skills, domain experience, location preference, FTE need, and flexibility notes. |
| Supply filters | Bench status, partial capacity, release window, region, city, timezone, grade, role archetype, domain, and skill filters. |
| Approval context | EWA status, request status, booking owner, blocking reason, and proposed booking dates. |
| Scenario selection | Planning scenario, target date, target bench rate, target headcount, and focus area. |
| Review mode | Persona-oriented review context such as workforce planner, sales or client partner, delivery manager, or regional leader. |

# 6. Functional Requirements

## 6.1 Data Ingestion and Reference Data

### Responsibilities

The system shall ingest and present the dataset entities that support workforce planning, including people, skills, profiles, allocations, bench, partial capacity, availability calendar, project history, opportunities, opportunity roles, opportunity overlays, EWA requests, scenario targets, starter prompts, and validation summary data.

The system shall treat the dataset as the source of planning truth for the MVP and shall not require external systems to operate the core workflow.

The system shall preserve workbook-specific business rules that materially affect planning outcomes, including the rule that Partial Capacity is a filtered planning view and shall not be double-counted on top of Bench totals.

### Output

The system shall provide normalized workforce records suitable for search, filtering, matching, and explanation generation.

The system shall expose validation and reference context so users can understand dataset assumptions, metric definitions, and known limits of the MVP data pack.

## 6.2 Opportunity Assessment

### Responsibilities

The system shall allow a user to create or review an opportunity with one or more required roles.

The system shall capture role-level requirements, including skills, grade, domain, location, FTE, start date, duration, and flexibility notes.

The system shall assess whether each role has a feasible supply match from available workforce records.

### Output

The system shall produce a structured opportunity requirement summary and identify missing or ambiguous inputs before staffing recommendations are generated.

## 6.3 Resource Supply Analysis

### Responsibilities

The system shall evaluate current and future supply using bench records, partial-capacity records, and the weekly availability calendar.

The system shall support supply views by current bench, rolling release window, and upcoming availability within at least a 12-week planning horizon.

The system shall use availability timing rules from the dataset so that release timing and partial-capacity transitions are not overstated.

The system shall distinguish between current bench, partial-capacity supply, and future roll-off supply without inflating total available FTE.

### Output

The system shall return a ranked list of available or near-available candidates with their available FTE, release date, bench status, and supply risk.

## 6.4 Candidate Matching and Team Building

### Responsibilities

The system shall match candidates to opportunity roles using relevant signals such as skills, skill level, years of experience, domain experience, grade, location, availability, work mode, and project history.

The system shall support multiple staffing options for the same role, including best-fit, fastest-available, and balanced options.

The system shall support partial-capacity assignment logic where role FTE can be split only when the role allows it and the minimum individual FTE threshold is met.

The system shall return explicit outcomes when no candidate is feasible, when a candidate is capability-fit but availability-blocked, and when a candidate is available but below the desired capability threshold.

### Output

The system shall produce one or more team recommendations with match scores, candidate ordering, and any remaining FTE gaps.

## 6.5 Opportunity Prioritization and Scenario Planning

### Responsibilities

The system shall support prioritization across multiple opportunities when scarce candidates overlap between roles or accounts.

The system shall consider opportunity probability, commercial priority, role demand, start timing, and scenario goals when recommending where limited supply should be allocated first.

The system shall support scenario analysis grounded in the workbook targets, including reducing current bench, prioritizing high-probability pipeline, using partial capacity for discovery, protecting Creative Services coverage, identifying no-fit bench cases, and resolving capability or availability gaps.

### Output

The system shall produce scenario-aware prioritization guidance, tradeoff explanations, and recommended next actions for constrained staffing situations.

## 6.6 Risk and Insights

### Responsibilities

The system shall identify staffing risks such as insufficient availability, grade mismatch, location mismatch, skill gaps, and approval blockers.

The system shall provide a confidence or fit assessment for each recommendation.

The system shall explain why a candidate is recommended, backed by dataset evidence where possible.

The system shall separate capability fit from availability feasibility so a high-skill but unavailable candidate is not presented as fully viable without qualification.

### Output

The system shall produce a risk summary, capability gap summary, and next-action guidance for planners and approvers.

## 6.7 Approval and Decision Support

### Responsibilities

The system shall prepare a recommendation package for human approval.

The system shall surface EWA status, request status, blocking reasons, and proposed booking dates before a recommendation is finalized.

The system shall keep the planner or approver in control of the final decision and shall not auto-approve staffing changes.

The system shall treat EWA requests as the booking-status source of truth for approval-state reporting in the MVP.

### Output

The system shall produce an approval-ready summary that can be reviewed before EWA submission or booking action.

## 6.8 Ask, Chat Workspace, and Dashboard Review

### Responsibilities

The system shall present workforce planning data in an ask flow, chat workspace, and dashboard review experience that supports opportunity review, candidate comparison, EWA follow-up, and dataset-level analysis.

The system shall support inspection of recommendation details without forcing users to navigate raw dataset tables.

The system shall support persona-relevant views or prompts for at least workforce planners, sales or client partners, delivery managers, and regional leaders.

The system shall hand off a user's first question from `/ask` into `/workspace`, preserve the active dataset context, and create or continue the relevant planning conversation.

The system shall display tool-specific evidence in the workspace detail panel using the structured JSON returned by the backend contract for opportunity assessment, resource supply, team builder, risk insights, and approval decision responses.

The system shall support a resizable chat and evidence layout so users can expand the chat panel or detail panel without horizontal overflow.

The system shall provide a static dashboard route for scanning uploaded dataset snapshots outside the chat flow.

The system shall let users preview raw workbook rows and download the original uploaded workbook from the static dashboard after dataset ownership validation.

### Output

The system shall provide concise operational views of opportunity demand, supply availability, recommendations, risks, approval status, raw contract evidence, and source workbook context where relevant.

# 7. Non-Functional Requirements

## Performance

- The system shall return standard search and filtering results quickly enough for interactive planning use.
- The system shall support dataset sizes at least equivalent to the provided 500-employee workbook without degraded core workflow usability.

## Reliability

- The system shall continue to function when some candidate records are incomplete, provided the fields needed for matching are present.
- The system shall degrade gracefully when optional signals such as project history or desired skills are missing.

## Accuracy / Correctness

- The system shall not overstate availability beyond the dataset-defined bench and availability logic.
- The system shall preserve EWA request status as the source of truth for approval-related planning states.
- The system shall align recommendation outputs with the validated workbook data rather than inventing workforce records.

## Usability

- The system shall present staffing recommendations in language that planners and delivery managers can understand without interpreting raw scores alone.
- The system shall make reasons for recommendation and rejection visible in the same review flow.

## Security and Privacy

- The system shall not require real employee or client data for the MVP.
- The system shall treat the included workbook as synthetic and anonymized reference data.
- The system shall restrict approval and booking actions to users with appropriate planning or approval roles when those roles are implemented.

## Scalability

- The system shall be designed so the planning workflow can scale beyond the initial workbook size without changing the user-facing process.

# 8. System Modules

- Opportunity Intake Module
- Supply Analysis Module
- Candidate Matching Module
- Team Recommendation Module
- Opportunity Prioritization and Scenario Module
- Risk and Insights Module
- Approval and EWA Support Module
- Ask and Chat Workspace Module
- Tool Evidence Detail Panel Module
- Planning Dashboard Module
- Dataset Validation and Reference Module

# 9. MVP Features

The first release shall include:

- Opportunity creation and review for staffing demand.
- Role-level requirements capture for skills, grade, domain, location, FTE, and schedule.
- Workforce supply analysis using bench, partial capacity, and availability data.
- Candidate ranking and staffing option generation.
- Opportunity prioritization when supply conflicts exist across roles or opportunities.
- Scenario analysis for bench reduction, pipeline prioritization, partial-capacity use, and no-fit cases.
- Risk, gap, and confidence explanations.
- Human approval support with EWA visibility.
- `/ask` entry flow that hands the first question into the chat workspace.
- Workspace chat with conversation history, active dataset context, and tool-specific evidence UI.
- Resizable chat and detail panels for comparing recommendations and inspecting JSON-backed evidence.
- Static dashboard for reviewing uploaded dataset snapshots.

The first release shall NOT include:

- Fully automated staffing decisions without human approval.
- Live integration with external HR, ERP, or ATS systems.
- Real-time collaboration or multi-user editing beyond basic review behavior.
- Forecasting, reskilling, or team chemistry features beyond the MVP recommendation scope.
- Production handling of real employee data unless separately approved and secured.

# 10. Success Criteria

- Users can identify candidate options for a role using the provided workforce data.
- Users can explain why a recommendation was made using evidence from skills, availability, and history data.
- Users can see when a recommendation is blocked by availability or EWA status.
- Users can distinguish best-fit, fastest-available, and balanced staffing options.
- Users can see when partial-capacity supply is usable, when it would be double-counted, and when a role cannot be feasibly filled from current supply.
- Users can compare competing opportunities and understand which opportunity should receive scarce candidates first.
- The system can operate end-to-end on the included dataset without requiring external data sources.

# 11. Future Enhancements

- Hosted Workforce Router Agent execution as a replacement for the current deterministic workspace route
- Skills gap analysis
- Workforce forecasting
- Bench risk prediction
- Team chemistry insights
- What-if scenario planning
- Reskilling pathway recommendations
- Deeper automation of approval packet generation

# 12. Expected User Flow

1. A user signs in on the DavaForce home page.
2. The user uploads a workforce workbook.
3. The system imports, validates, and normalizes the workbook into the local dataset store.
4. The user opens `/ask` and enters a workforce planning question.
5. The ask flow hands the prompt and active dataset into `/workspace`.
6. The workspace chat route classifies the question, runs the required deterministic planning tools, and stores the conversation.
7. The chat panel shows the answer and conversation history.
8. The detail panel renders the structured JSON contract as a tool-specific evidence UI.
9. The user can resize the chat and detail panels to compare messages, metrics, tables, charts, risks, and raw contract evidence.
10. The user can open `/dashboard` to review static dataset-level supply, demand, staffing-fit, skills, and EWA views.
11. The user can preview raw Excel rows or download the original workbook from the dashboard when source-data inspection is needed.
12. The planner uses the recommendation and EWA context to decide whether to submit, revise, or defer the plan.
