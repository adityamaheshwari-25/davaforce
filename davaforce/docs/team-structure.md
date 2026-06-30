# Team Structure Guide

DavaForce runs as one Next.js server, but the code is organized so frontend, backend, and shared routing work stay in clear ownership areas.

## Folder Roles

```text
davaforce/
  frontend/   Frontend-owned UI, feature modules, shell components, hooks, and assets
  backend/    Backend routes, data import, router agent, tools, workflows, and scripts
  src/app/    Thin Next.js bridge for app and API routes
  public/     Runtime-ready static assets served by Next.js
  docs/       Requirements, architecture, contracts, and team guidance
```

## Frontend Ownership

Frontend feature work belongs in:

```text
frontend/src/features/
```

Current feature modules:

```text
frontend/src/features/home/
frontend/src/features/dashboard/
frontend/src/features/workspace/
```

Shared frontend pieces live in:

```text
frontend/src/components/
frontend/src/components/shell/
frontend/src/components/ui/
frontend/src/hooks/
frontend/src/lib/
```

Route files under `frontend/src/app/` should stay thin. They should import the feature implementation and export it, instead of growing into large page files.

Example:

```ts
import DashboardPage from "@/features/dashboard/dashboard-page";

export default DashboardPage;
```

## Backend Ownership

Backend, data, router-agent, and tool work belongs in:

```text
backend/
```

Backend-owned areas include:

- API route handlers
- Excel import and validation
- dataset storage and normalization
- dashboard/chat data services
- Workforce Router Agent, Mastra tools, schemas, and workflows
- backend scripts

Typical backend paths:

```text
backend/src/next/
backend/src/lib/
backend/src/mastra/
backend/scripts/
backend/python-scripts/
```

## Why Root `src/app` Exists

Next.js expects active App Router entries under `src/app`.

This project keeps most implementation in `frontend/` and `backend/`, so root `src/app` is only the bridge that exposes those modules through one server.

Examples:

```text
src/app/[[...slug]]/page.tsx
src/app/api/[...path]/route.ts
src/app/layout.tsx
```

Most feature work should not happen in root `src/app`.

## Adding A Frontend Route

1. Build the real screen under `frontend/src/features/<feature>/`.
2. Add a thin route wrapper under `frontend/src/app/<route>/page.tsx`.
3. Register the route in `src/app/[[...slug]]/page.tsx` if the bridge needs to expose it.

Example:

```ts
import PlanningPage from "@/features/planning/planning-page";

export default PlanningPage;
```

## Adding A Backend API Route

1. Implement the route handler in `backend/src/next/`.
2. Register it in `src/app/api/[...path]/route.ts`.

Example:

```ts
import { GET as routeGET } from "../../../../backend/src/next/report-route";
```

## Assets

Use `frontend/assets/` for source/design assets owned by frontend.

Use `public/` only for runtime-ready assets that must be served directly by URL, such as:

```text
public/favicon.png
public/assets/davaforce-logo-mark.png
```

## Run Commands

Run everything from the app folder:

```powershell
cd davaforce
npm install
npm run dev
```

Build:

```powershell
npm run build
```

## Rule Of Thumb

If you are building UI, work in `frontend/src/features` or shared frontend components.

If you are building API, data import, Excel traversal, router-agent logic, tools, or workflows, work in `backend/`.

If you are only exposing a page or API route to Next.js, update the small bridge in root `src/app/`.
