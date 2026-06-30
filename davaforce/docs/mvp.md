# DavaForce - MVP Architecture

## Overview

An AI-powered workforce planning platform that transforms staffing demand into evidence-backed team recommendations while keeping human approval through EWA at the center of decision-making.

The platform uses structured workforce data, deterministic filtering/scoring, one Workforce Router Agent, deterministic tools, and session memory to support multi-turn workforce planning conversations.

Terminology used in this document:

* **Agent** means the `Workforce Router Agent` Mastra wrapper. It owns question routing and delegates to deterministic tools.
* **Tool** means the deterministic implementation in `backend/src/mastra/tools`. Tools perform the actual DB-backed planning calculations.
* **Sub-tool** means a lower-level helper in `backend/src/lib/agent-tools` used by the main tools for availability, capacity, skills, scoring, team construction, risk, explanations, and EWA packaging.
* **Current workspace chat runtime** means `backend/src/next/workforce-chat-route.ts`. Today this route calls the deterministic router/tool layer directly and returns structured details for the frontend evidence panel.

---

# Technology Stack

| Layer                  | Technology                                |
| ---------------------- | ----------------------------------------- |
| Frontend               | Next.js (React + TypeScript)              |
| UI                     | Tailwind CSS + shadcn/ui                  |
| Backend                | Next.js API Routes / Server Actions       |
| AI Orchestration       | Mastra AI                                 |
| Database               | SQLite for MVP, PostgreSQL for Production |
| ORM                    | Prisma                                    |
| Data Import            | xlsx npm package                          |
| Memory / Session State | SQLite-backed conversation memory         |
| Deployment             | Local MVP, Vercel / Docker later          |

---

# Data Pipeline

The Excel dataset is the starting source. It is imported once, cleaned, normalized, and stored in application tables. The planning tools do not read the Excel file directly during runtime.

The current implementation already preserves every workbook row in `RawSheetRow` and normalizes the planning-critical sheets into SQLite. The MVP architecture must explicitly include the sheets that drive forecasting, fit scoring, and demo prompts:

* `Skill Catalog`
* `Bench Movement`
* `Opportunity Overlays`
* `Scenario Targets`
* `Starter Prompts`

`Starter Prompts` can remain raw-only for import traceability and chat testing. They are not part of the static dashboard; they are optional ask/chat suggestions for quickly exercising the implemented tool paths.

The static dashboard can inspect the preserved source workbook without changing planning calculations. `GET /api/workforce-datasets/raw` reads `RawSheetRow` for a sheet-level preview, while `GET /api/workforce-datasets/download` returns the original uploaded `.xlsx` file. Deterministic planning tools should continue to use the normalized canonical tables.

```text
Excel Dataset
        |
        v
Excel Import Script
(xlsx npm package)
        |
        v
Raw Import Tables
(raw_people, raw_skills, raw_allocations, raw_opportunities, ...)
        |
        v
Data Cleaning & Normalization Layer
        |
        v
Normalized Application Database
(SQLite for MVP / PostgreSQL for production)
        |
        v
Prisma ORM
        |
        v
DavaForce Engine
        |
        v
Mastra Workforce Router Agent + Tools
        |
        v
Next.js API Routes / Server Actions
        |
        v
Next.js Frontend
```

---

# System Architecture

The codebase has one registered Mastra Workforce Router Agent and deterministic Mastra tools. The active Next.js chat API currently calls the tools directly, while the router agent defines the hosted-agent interface when Mastra execution is used.

```text
                    Excel Dataset
                          |
                          v
             Data Import & Normalization
           (xlsx + ETL/Cleaning Script)
                          |
                          v
          Normalized Application Database
          (SQLite for MVP / PostgreSQL later)
                          |
                          v
                      Prisma ORM
                          |
                          v
              DavaForce Engine
--------------------------------------------------------------
- availabilitySearch()
- capacityCalculator30_60_90()
- skillsMatcher()
- candidateScorer()
- teamOptionBuilder()
- riskAnalyzer()
- explanationGenerator()
- ewaRecommendationBuilder()
--------------------------------------------------------------
                          |
                          v
              Workforce Router Agent
             (routing wrapper and instructions)
                          |
                          v
                Deterministic Tool Layer
              (DB-backed planning functions)
                          |
          +---------------+---------------+
          v                               v
 Opportunity Assessment Tool       Resource Supply Tool
          |                               |
          +---------------+---------------+
                          v
                  Team Builder Tool
                          |
                          v
                 Risk & Insights Tool
                          |
                          v
              Approval & Decision Tool
                          |
                          v
        Next.js API Routes / Server Actions
                          |
                          v
                  Next.js Frontend
 Home Upload / Ask / Chat Workspace / Dashboard / Evidence Panel
```

---

# Runtime Execution Model

The implemented planning logic lives in Mastra tools. The active `/api/workforce-chat` route imports the deterministic router and tools from `backend/src/mastra/tools` directly.

There is no current parallel hosted specialist execution in the workspace chat route. Tool functions run synchronously in the order required by the selected intent path.

```text
User Request
     |
     v
Workforce Router Tool
     |
     +---------------> Opportunity Assessment Tool
     |
     +---------------> Resource Supply Tool
                              |
                              v
                       Team Builder Tool
                              |
                              v
                      Risk & Insights Tool
                              |
                              v
                   Approval & Decision Tool
                              |
                              v
              Structured evidence + tool summary
                              |
                 +------------+------------+
                 |                         |
                 v                         v
     OpenAI response composer       Hardcoded tool message
     when OPENAI_API_KEY exists     fallback when AI is absent
```

Implemented runtime paths:

| Path | What exists | What runs |
| ---- | ----------- | --------- |
| Current workspace chat | Direct router/tool imports plus optional OpenAI response composition in `workforce-chat-route.ts` | `routeWorkforceQuestion()` plus deterministic tool calls selected by intent; OpenAI rewrites the final chat-facing answer when configured |
| Workforce Router Agent | `workforceRouterAgent` and `workforceRouterTool` | `workforceRouterTool` is called by workspace chat; the router agent is the only registered Mastra agent |
| Opportunity Assessment Tool | `opportunityAssessmentTool` | `assessOpportunity()` is called by the router when demand intent is selected |
| Resource Supply Tool | `resourceSupplyTool` | `findResourceSupply()` is called by the router when supply intent is selected |
| Team Builder Tool | `teamBuilderTool` | `buildTeamOptions()` is called by workspace chat or the router when team intent is selected |
| Risk & Insights Tool | `riskInsightsTool` | `buildRiskInsights()` is called by the router when risk intent is selected |
| Approval & Decision Tool | `approvalDecisionTool` | `buildApprovalDecision()` is called by the router when approval or EWA intent is selected |

The workspace chat API returns `detailView`, `details`, the legacy compatibility field `agentsUsed`, and routing evidence so the frontend can render the right-side tool evidence panel from specialist workforce tool output. The `agentsUsed` field should contain `workforce-router-agent` plus selected tool IDs.

Final response wording follows an OpenAI-first, deterministic-fallback approach:

* Deterministic tools always produce the authoritative evidence, selected detail view, cards, tables, JSON, routing path, and tool summary.
* If `OPENAI_API_KEY` is configured, `workforce-chat-route.ts` sends the user question, recent chat context, and structured tool evidence to the configured `OPENAI_MODEL`. The model may synthesize a more natural chat answer, but it must use only supplied evidence.
* If `OPENAI_API_KEY` is missing, the OpenAI request fails, or the model returns no usable text, the API returns the existing hardcoded tool summary such as approval-package, team-builder, risk, supply, or opportunity-assessment messages.
* The right-side evidence panel remains deterministic in both modes. AI only affects the assistant-facing prose, not the underlying calculations or approval state.

---

# Frontend Application Structure

The route files under `frontend/src/app` are intentionally thin. The main implementation lives in feature folders:

```text
frontend/src/features/home/
frontend/src/features/dashboard/
frontend/src/features/workspace/
frontend/src/components/shell/
frontend/src/components/ui/
```

Implemented frontend routes:

| Route | Purpose |
| ---- | ------- |
| `/` | DavaForce sign-in, upload, and workbook processing flow |
| `/ask` | First-question entry screen for the active uploaded dataset |
| `/workspace` | Resizable chat workspace with a JSON-backed tool evidence panel |
| `/dashboard` | Static dashboard for dataset-level supply, demand, staffing fit, skills, EWA views, raw Excel preview, and source workbook download |

The root `src/app` folder remains a bridge that exposes these frontend pages and backend API routes through one Next.js server.

## Workforce Router

Runs from:

* User question
* Dataset ID / DB path
* Optional selected opportunity, role, skills, filters, and preferred option type

Produces:

* Classified intent
* Logical execution plan
* Logical specialist path
* Routed JSON outputs
* Final response type
* Evidence explaining the routing decision

## Specialist Areas

Each specialist area is implemented as a deterministic tool:

* a routed tool in `backend/src/mastra/tools`
* lower-level sub-tools in `backend/src/lib/agent-tools` where shared availability, skills, capacity, scoring, risk, or explanation logic is needed

### Opportunity Assessment

Runs from:

* User query
* Opportunity description
* Existing opportunity record

Produces:

* Required roles
* Required skills
* Grade
* Location
* Timeline

### Resource Supply

Runs from:

* Normalized workforce database
* Availability data
* Allocation data
* Bench data
* Bench movement data
* Skills data

Produces:

* Available people
* Bench capacity
* Partial capacity
* 30/60/90-day supply
* 12-week available FTE and bench pressure trends

---

# Specialist Dependency Model

## Team Builder

Depends on:

```text
Opportunity Assessment Output
        +
Resource Supply Output
```

It needs both:

* What roles are required
* Which people are available

Then it builds role-wise candidates and team options.

---

## Risk & Insights

Depends on:

```text
Team Builder Output
```

It evaluates:

* Confidence
* Delivery risk
* Skill gaps
* Availability risk
* Bench impact
* Regional capacity impact

---

## Approval & Decision

Depends on:

```text
Opportunity Assessment Output
        +
Resource Supply Output
        +
Team Builder Output
        +
Risk & Insights Output
```

It prepares:

* Final recommendation
* EWA summary
* Human approval package

---

# Memory and Multi-Turn Query Handling

The system should not start from zero for every user query. It should keep session-level memory for the active planning conversation.

```text
User Query
        |
        v
Session Memory Lookup
        |
        v
Understand What Changed
        |
        v
Reuse Existing Context
        |
        v
Run Only Required Tools
        |
        v
Update Session Memory
        |
        v
Return Answer
```

## Memory Types

```text
Database Memory
Source of truth for workforce data.

Session Memory
Stores the current user conversation, selected persona, active opportunity, filters, and previous results in the application SQLite memory database.
Workspace chat history is listed at the user level across uploaded datasets so a new workbook upload does not hide previous planning conversations.

Tool Output Memory
Stores intermediate outputs such as parsed requirements, shortlisted candidates, team options, risks, and explanations.
```

## Dataset and Conversation Lifecycle

One uploaded workbook creates one `datasetId`. A single dataset can have many conversation IDs, and each conversation stores its own message history, selected detail JSON, active opportunity context, and tool output memory.

Runtime rules:

* Uploading a workbook changes the active dataset only after import succeeds.
* Visiting the upload/home screen without uploading a new workbook does not change the active dataset.
* `/ask` starts a new conversation against the currently active dataset.
* `/workspace` continues the active conversation, unless it receives a fresh `/ask` handoff, in which case it creates a new conversation.
* Opening a previous chat from history restores that conversation and switches the active dataset context to the dataset tied to that conversation.
* Dashboard views read static dashboard data from the active dataset, not from the chat message list.
* Empty placeholder conversations should not be created on upload and should not appear in chat history.

---

# Example Multi-Turn Flow

## Query 1

```text
Find Java developers available in 30 days for a banking project.
```

System stores:

```text
Active opportunity = Banking project
Required role = Java Developer
Skill = Java
Availability window = 30 days
Shortlisted candidates = Candidate list
Previous recommendation = Team options
```

Specialists used:

```text
Opportunity Assessment
Resource Supply
Team Builder
Risk & Insights
Approval & Decision
```

---

## Query 2

```text
What if we need them in 60 days?
```

System reuses:

```text
Banking project context
Java Developer role
Skill requirements
Previous candidate pool
Previous scoring logic
```

System updates:

```text
Availability window = 60 days
Candidate ranking
Risks
Team options
```

Specialists used:

```text
Resource Supply
Team Builder
Risk & Insights
Approval & Decision
```

The Opportunity Assessment specialist may be skipped because the opportunity did not change.

---

## Query 3

```text
Why was this person selected?
```

System reuses:

```text
Previous recommendation
Candidate evidence
Skill match
Availability match
Risk notes
```

Specialists used:

```text
Risk & Insights
explanationGenerator()
```

The full workflow does not need to run again.

---

# Runtime Query Strategy

The system does not query the Excel file at runtime.

```text
User Question / Opportunity
        |
        v
Session Memory + Persona Context
        |
        v
Structured Filters
(role, skill, grade, location, availability window, domain)
        |
        v
Prisma Query
        |
        v
DavaForce Engine
(filtering, scoring, ranking)
        |
        v
Shortlisted Candidates / Team Options
        |
        v
Mastra Tools / Optional Router Agent
(reasoning support, explanation, risks, approval summary)
        |
        v
Next.js Dashboard
```

Use:

```text
Structured workforce data -> Prisma + SQL queries
Unstructured documents or policies -> RAG later if needed
LLM / Mastra -> explanation, reasoning, and persona-specific response
```

---

# Runtime Pattern

Planning tools and the Workforce Router Agent do not remain permanently open as long-running processes. They are called on demand by the Next.js API route or by a Mastra runtime.

Recommended model:

```text
Long-running:
- Next.js application
- Database
- Mastra tooling / optional workflow service
- Session memory

On-demand:
- Tool calls
- Optional Workforce Router Agent execution
- Scoring functions
- Explanation generation
```

This keeps the system efficient while still allowing the user to ask multiple follow-up questions using memory.

---

# Specialist Responsibilities

## 1. Opportunity Assessment

### Purpose

Analyze staffing demand from new or existing opportunities.

### Responsibilities

* Extract required roles
* Identify mandatory skills
* Determine seniority or grade
* Identify location requirements
* Capture start date and duration
* Normalize opportunity information

### Output

```text
Opportunity Requirements
Required Roles
Skills Needed
Project Timeline
Location
Grade
```

---

## 2. Resource Supply

### Purpose

Understand current and future workforce availability.

### Responsibilities

* Find available employees
* Check bench resources
* Analyze partial allocations
* Calculate 30/60/90-day availability
* Forecast 12-week availability and bench movement from `BenchMovementWeek`
* Determine utilization

### Output

```text
Available Candidates
Bench Capacity
Future Availability
Current Utilization
Bench Pressure Trend
```

---

## 3. Team Builder

### Purpose

Generate role-wise and team-level staffing options.

### Responsibilities

Match candidates using:

* Skills
* Availability
* Grade
* Location
* Domain expertise
* Project experience

Generate:

* Best Fit Team
* Fastest Available Team
* Balanced Team

It must also enforce role staffing rules:

* Use `OpportunityCandidateOverlay` as a seed or validation source for fit scoring during the MVP.
* Respect `MinimumIndividualFTE` before combining partial-capacity candidates.
* Respect `CanCombineCandidates` / `CanSplitRole`; do not split a role when the opportunity role says candidates cannot be combined.

---

## 4. Risk & Insights

### Purpose

Evaluate recommendations and identify risks.

### Responsibilities

* Confidence scoring
* Capability gap analysis
* Staffing risks
* Bench impact
* Utilization impact
* Regional capacity impact
* Next actions

Intentional no-fill skill gaps must be handled as planning risks, not import failures. The current dataset intentionally has no matching workforce rows for:

* `Service Blueprinting`
* `User Interviews`
* `Accessibility`

When these appear as required skills, the specialist output should label them as no-fill / no-fit gaps, explain the impact, and recommend mitigation such as hiring, partner support, training, or scope changes.

Supports advanced future enhancements:

* Bench risk prediction
* Workforce forecasting
* Team chemistry
* What-if scenario planning
* Reskilling recommendations

---

## 5. Approval & Decision

### Purpose

Prepare the final recommendation for human approval.

### Responsibilities

* Summarize recommendations
* Explain team selection
* Generate EWA recommendation
* Prepare approval package
* Keep human decision-maker in control

---

# DavaForce Engine

The planning flow reuses deterministic tools instead of implementing duplicate logic. The LLM does not scan the full dataset. It receives filtered and scored results from these tools.

```text
availabilitySearch()

capacityCalculator30_60_90()

skillsMatcher()

candidateScorer()

teamOptionBuilder()

riskAnalyzer()

forecastAvailability()

generateExplanation()

ewaRecommendationBuilder()
```

---

# Database Schema

## Raw Import Tables

```text
raw_people
raw_roles
raw_skills
raw_skill_catalog
raw_profiles
raw_allocations
raw_availability
raw_bench
raw_partial_capacity
raw_bench_movement
raw_project_history
raw_opportunities
raw_opportunity_roles
raw_opportunity_overlays
raw_ewa_requests
raw_scenario_targets
raw_starter_prompts
```

## Normalized Application Tables

```text
People
PersonAvailabilitySnapshot
Roles
Profiles
SkillCatalog
PersonSkillEvidence
CurrentAllocation
SupplyRecord
PartialCapacityView
AvailabilityWeek
BenchMovementWeek
ProjectHistory
Opportunities
OpportunityRoles
OpportunityRoleSkillRequirement
OpportunityCandidateOverlay
EWARequests
ScenarioTarget
Recommendations
RecommendationEvidence
Sessions
SessionMemory
ToolRuns
```

## Critical ETL and Planning Rules

* `SkillCatalog` is the canonical skill reference used by `skillsMatcher()` and opportunity role requirements.
* `Bench` has mixed records. Do not treat all bench rows as current bench. Filter by `BenchType` / `AvailabilityCategory`:
  * `Current Bench`
  * `Partial Capacity`
  * `Future Roll-off`
* `BenchMovementWeek` drives 12-week trend reporting for supply forecasting and the Regional Leader persona.
* `OpportunityCandidateOverlay` contains precomputed `CapabilityFitScore`, `AvailabilityFitScore`, `OverallStaffingScore`, and `FTEGap`. Use it to seed or validate `candidateScorer()` during the MVP.
* `MinimumIndividualFTE` and `CanCombineCandidates` are required staffing constraints for `teamOptionBuilder()`.
* Unsupported required skills are valid business gaps when they are absent from workforce supply. They should be surfaced as no-fill gaps, not treated as broken data.

---

# Personas and Starter Prompts

The MVP chat experience should expose persona-specific starter prompts so each stakeholder can test a complete flow quickly.

```text
Sarah - Workforce Planner
Jenny - Delivery Manager
Raj - Sales / Client Partner
David - Regional Leader
```

David's Regional Leader flow should use the 12-week availability and bench movement data to explain available FTE trends and bench pressure points.

The ask/chat screen should also include the portfolio-level prompt that builds the strongest feasible staffing plan across all 15 opportunities. This is a high-value demo path because it uses demand, supply, overlays, EWA, and risk analysis together.

---

# End-to-End Workflow

```text
Excel Dataset
        |
        v
Import & Normalize Data
        |
        v
User signs in
        |
        v
User uploads workforce workbook
        |
        v
User asks first question in /ask
        |
        v
Session memory is checked
        |
        v
Workspace Chat Runtime Path
Chooses and calls the required deterministic tools
        |
        v
Opportunity Assessment + Resource Supply
Run when demand/supply evidence is needed
        |
        v
Team Builder
Generate staffing options when team planning is needed
        |
        v
Risk & Insights
Evaluate risks, gaps, and confidence when risk evidence is needed
        |
        v
Approval & Decision
Prepare EWA recommendation and human approval package when approval evidence is needed
        |
        v
Session memory is updated
        |
        v
Next.js Workspace / Dashboard
Displays chat answers, resizable evidence details, raw contract JSON, static dashboard views, raw Excel preview, and workbook download
```

The end-to-end path is conditional. For example, a demand-only question can stop after Opportunity Assessment, while an EWA blocker or final recommendation question routes through Approval & Decision.

---

# MVP Features

* Import Excel workforce dataset into a local database
* Preserve raw imported data for debugging and re-imports
* Clean and normalize workforce data before AI processing
* Consolidate people, skill catalog, skill evidence, profiles, allocations, bench, partial capacity, bench movement, and project history
* Show current availability and upcoming workforce supply for 30/60/90 days
* Show 12-week supply and bench movement trends
* Allow users to define opportunities and required roles
* Import opportunity overlays to seed or validate candidate fit scoring
* Enforce `MinimumIndividualFTE` and `CanCombineCandidates` during team option generation
* Surface persona-specific starter prompts, including the Regional Leader flow
* Provide a DavaForce-branded upload, ask, workspace, and dashboard UI
* Allow dashboard users to view raw workbook rows and download the original uploaded Excel file
* Support multi-turn planning conversations using session memory
* Reuse previous context from follow-up questions
* Answer workspace chat questions through deterministic evidence
* Use OpenAI for final response wording when `OPENAI_API_KEY` is configured
* Fall back to hardcoded deterministic tool messages when AI is unavailable or not configured
* Return per-message detail JSON for the workspace panel
* Render tool-specific evidence dashboards for opportunity, supply, team builder, risk, and approval contracts
* Support resizable chat and evidence panels without horizontal overflow
* Compose dependent tools synchronously when one tool needs another tool's output
* Recommend suitable candidates based on:

  * Skills
  * Availability
  * Grade
  * Location
  * Domain expertise
  * Project experience
* Generate multiple staffing options with explanations:

  * Best Fit Team
  * Fastest Available Team
  * Balanced Team
* Highlight confidence scores, risks, capability gaps, and next actions
* Treat unsupported required skills as explicit no-fill / no-fit risks
* Use the Approval & Decision Tool for EWA, approval, blocker, and final recommendation questions when routed by workspace chat
* Preserve EWA as the final approval process
* Keep human judgment at the center of staffing decisions

---

# Future Enhancements

* RAG over unstructured documents such as policies, role descriptions, CVs, and staffing guidelines
* Workforce forecasting
* Bench risk prediction
* Team chemistry insights
* What-if scenario planning
* Reskilling pathway recommendations
* PostgreSQL migration for production scale
* Event-driven specialist execution
* Cached workforce indexes for static datasets

---

# Project Summary

**DavaForce** is a tool-driven workforce planning solution that imports and normalizes workforce data, analyzes staffing demand, evaluates workforce availability, builds optimized teams, explains recommendations, and supports evidence-based workforce planning.

The system uses the Workforce Router Agent, deterministic tools, and session memory for multi-turn conversations. Final staffing decisions remain under human control through the EWA approval process.
