# API Contracts

This document is the contract for the HTTP API exposed by this server.

Scope:

- request methods
- endpoint paths
- headers and content types
- query parameters
- request body formats
- response body formats
- status codes
- side effects and persistence behavior
- ownership and validation rules

Maintenance rule:

- Every time an API endpoint is added, removed, or its behavior changes, update this file in the same change set.
- Do not treat this file as optional documentation. It is part of the server contract.
- If a route has multiple response shapes, each shape must be documented here.

## Server Summary

Base URL in local development:

```text
http://localhost:3000
```

Current API surface:

- `POST /api/auth/login`
- `POST /api/workforce-datasets`
- `GET /api/workforce-datasets`
- `PATCH /api/workforce-datasets`
- `GET /api/workforce-datasets/raw`
- `GET /api/workforce-datasets/download`
- `GET /api/workforce-datasets/dashboard`
- `GET /api/workforce-datasets/dashboard/summary`
- `GET /api/workforce-datasets/dashboard/supply`
- `GET /api/workforce-datasets/dashboard/demand`
- `GET /api/workforce-datasets/dashboard/staffing-fit`
- `GET /api/workforce-datasets/dashboard/skills`
- `GET /api/workforce-datasets/dashboard/skills/gaps`
- `GET /api/workforce-datasets/dashboard/ewa`
- `POST /api/workforce-chat`

## Global Conventions

### Response format

Most endpoints return JSON.

Common success envelope:

```json
{
  "status": "success"
}
```

Common failure envelope:

```json
{
  "status": "failure",
  "error": "Human-readable error message"
}
```

Important exception:

- `POST /api/workforce-datasets` returns one `400` validation shape without `status` when the request is not `multipart/form-data`.
- `GET /api/workforce-datasets/download` returns binary `.xlsx` content on success and JSON only for failures.

### Authentication model

- There is no token-based authentication yet.
- The API currently uses dummy users stored in `data/app-state.db`.
- Frontend logs in first, receives `userId`, then includes that `userId` in dataset requests.
- Dataset ownership is enforced server-side using `userId`.

### Supported file type

- Only `.xlsx` files are accepted for workbook upload.

### Dataset ownership model

- Every uploaded workbook belongs to exactly one user.
- Every generated SQLite DB belongs to exactly one user.
- Datasets are stored under a user-specific folder.
- Read and update operations on datasets validate ownership.

### Storage side effects

Successful upload writes:

- original uploaded workbook
- generated SQLite database
- dataset metadata file
- nested static dashboard snapshot inside `dataset.json` after verification succeeds

Storage layout:

```text
data/
  workforce-datasets/
    <userId>/
      <datasetId>/
        <datasetId>.xlsx
        <datasetId>.db
        dataset.json
```

`dataset.json` stores the flat dataset metadata plus a nested `staticDashboard` object when the dashboard snapshot has been generated. The nested object contains:

- `schemaVersion`
- `generatedAt`
- `source`
- `history`
- `sections`

## Shared Data Models

### DummyUserPublic

Used by login responses.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `userId` | `string` | yes | Stable internal user identifier |
| `username` | `string` | yes | Login username |

Example:

```json
{
  "userId": "user_demo_001",
  "username": "demo"
}
```

### WorkforceDatasetClientRecord

Used in dataset success responses.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `datasetId` | `string` | yes | Unique identifier for the uploaded dataset |
| `ownerUserId` | `string` | yes | Owning user ID |
| `label` | `string \| null` | yes | Optional frontend label for the dataset |
| `dbFileName` | `string` | yes | Generated SQLite file name |
| `originalFileName` | `string` | yes | Original uploaded workbook name |
| `workbookVersion` | `string \| null` | yes | Workbook version read from the imported DB metadata |
| `createdAt` | `string` | yes | Dataset creation timestamp |
| `importCounts` | `Record<string, number>` | yes | Per-table import counts returned by the importer |
| `conversationIds` | `string[]` | yes | Conversation IDs associated with the dataset |

Example:

```json
{
  "datasetId": "wf_20260627101500_input-data_ab12cd34",
  "ownerUserId": "user_demo_001",
  "label": "April workforce workbook",
  "dbFileName": "wf_20260627101500_input-data_ab12cd34.db",
  "originalFileName": "input_data.xlsx",
  "workbookVersion": "v1",
  "createdAt": "2026-06-27T10:15:00+05:30",
  "importCounts": {
    "Person": 120,
    "Opportunity": 14
  },
  "conversationIds": [
    "conv-001"
  ]
}
```

### VerificationFailureItem

Used only in verification failure responses.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `passed` | `boolean` | yes | Will be `false` in this filtered failure list |
| `name` | `string` | yes | Verification check identifier |
| `detail` | `string` | yes | Failure detail string |

Example:

```json
{
  "passed": false,
  "name": "count:Person",
  "detail": "expected=120 actual=119"
}
```

### VerificationSummarySuccess

Used in successful upload responses.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `passed` | `number` | yes | Number of verification checks that passed |
| `failed` | `number` | yes | Number of verification checks that failed |

Example:

```json
{
  "passed": 73,
  "failed": 0
}
```

### VerificationSummaryFailure

Used in failed upload responses when import succeeded but verification failed.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `passed` | `number` | yes | Number of verification checks that passed |
| `failed` | `number` | yes | Number of verification checks that failed |
| `failures` | `VerificationFailureItem[]` | yes | Filtered list of failed checks |

## Endpoint: `POST /api/auth/login`

Validate dummy credentials and return the corresponding `userId`.

### Request

Headers:

```http
Content-Type: application/json
```

Body schema:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `username` | `string` | yes | Username to authenticate |
| `password` | `string` | yes | Password to authenticate |

Example request:

```json
{
  "username": "demo",
  "password": "demo123"
}
```

### Success response

Status code:

```text
200 OK
```

Body:

```json
{
  "status": "success",
  "success": true,
  "userId": "user_demo_001",
  "username": "demo"
}
```

Field notes:

| Field | Type | Description |
| --- | --- | --- |
| `status` | `"success"` | Envelope status |
| `success` | `true` | Explicit boolean success flag |
| `userId` | `string` | Stable user identifier to include in later API requests |
| `username` | `string` | Authenticated username |

### Failure responses

Missing required fields:

```text
400 Bad Request
```

```json
{
  "status": "failure",
  "success": false,
  "error": "username and password are required."
}
```

Invalid credentials:

```text
401 Unauthorized
```

```json
{
  "status": "failure",
  "success": false,
  "error": "Invalid username or password."
}
```

Unexpected parsing or handler error:

```text
400 Bad Request
```

```json
{
  "status": "failure",
  "success": false,
  "error": "Login failed."
}
```

### Notes

- Input strings are trimmed before validation.
- This endpoint does not create sessions or tokens.
- The returned `userId` is the identifier the frontend must persist for later dataset requests.

## Endpoint: `POST /api/workforce-datasets`

Upload an Excel workbook, create a SQLite DB, verify it, persist the dataset if verification passes, then build and store the static dashboard snapshot under `dataset.json.staticDashboard`.

### Request

Headers:

```http
Content-Type: multipart/form-data
```

Form-data fields:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `file` | `File` | conditional | Primary supported workbook upload field |
| `excel` | `File` | conditional | Alternate accepted workbook upload field |
| `workbook` | `File` | conditional | Alternate accepted workbook upload field |
| `userId` | `string` | yes | Owning user ID returned by login |
| `label` | `string` | no | Optional human-friendly label |
| `datasetLabel` | `string` | no | Alias for `label` |
| `conversationId` | `string` | no | Optional conversation ID to associate immediately |

Rules:

- At least one of `file`, `excel`, or `workbook` must be present.
- Uploaded file name must end with `.xlsx`.
- `userId` must map to an existing dummy user.

Example request:

```text
POST /api/workforce-datasets
```

```powershell
curl.exe -X POST ^
  -F "file=@python-scripts/input_data.xlsx;type=application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ^
  -F "userId=user_demo_001" ^
  -F "conversationId=conv-001" ^
  -F "label=April workforce workbook" ^
  http://localhost:3000/api/workforce-datasets
```

### Success response

Status code:

```text
201 Created
```

Body schema:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `status` | `"success"` | yes | Envelope status |
| `dataset` | `WorkforceDatasetClientRecord` | yes | Persisted dataset metadata returned to the frontend |
| `mastraInput` | `{ datasetId: string }` | yes | Input object the frontend can later pass into Mastra-driven flows |
| `verification` | `VerificationSummarySuccess` | yes | Verification result summary |

Example response:

```json
{
  "status": "success",
  "dataset": {
    "datasetId": "wf_20260627101500_input-data_ab12cd34",
    "ownerUserId": "user_demo_001",
    "label": "April workforce workbook",
    "dbFileName": "wf_20260627101500_input-data_ab12cd34.db",
    "originalFileName": "input_data.xlsx",
    "workbookVersion": "v1",
    "createdAt": "2026-06-27T10:15:00+05:30",
    "importCounts": {
      "Person": 120,
      "Opportunity": 14
    },
    "conversationIds": [
      "conv-001"
    ]
  },
  "mastraInput": {
    "datasetId": "wf_20260627101500_input-data_ab12cd34"
  },
  "verification": {
    "passed": 73,
    "failed": 0
  }
}
```

Notes:

- The success response still returns only `WorkforceDatasetClientRecord`.
- The static dashboard payload is persisted server-side in `dataset.json.staticDashboard` for later dashboard reads.

### Verification failure response

This shape is returned when import completed but verification failed. In this case the server deletes the dataset folder before returning the response.

Status code:

```text
422 Unprocessable Entity
```

Body:

```json
{
  "status": "failure",
  "error": "Workbook import verification failed.",
  "datasetId": "wf_20260627101500_input-data_ab12cd34",
  "verification": {
    "passed": 70,
    "failed": 3,
    "failures": [
      {
        "passed": false,
        "name": "count:Person",
        "detail": "expected=120 actual=119"
      }
    ]
  }
}
```

### Validation and input failure responses

Wrong content type:

```text
400 Bad Request
```

```json
{
  "error": "Expected multipart/form-data with a file field named file, excel, or workbook."
}
```

Other validation or handler failures:

```text
400 Bad Request
```

Example response:

```json
{
  "status": "failure",
  "error": "userId is required."
}
```

Other possible `error` messages:

- `Expected a multipart file field named file, excel, or workbook.`
- `Only .xlsx workbooks are supported.`
- `User not found: <userId>`
- `Failed to import workbook.`

### Side effects

On success:

- creates dataset directory under the owning user
- stores uploaded workbook
- creates SQLite database
- writes dataset metadata

On verification failure:

- deletes the dataset directory
- returns failure payload

On importer failure after directory creation:

- deletes the dataset directory before rethrowing

## Endpoint: `GET /api/workforce-datasets`

List all datasets for a user, or fetch a specific dataset for a user.

### Request

Query parameters:

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `userId` | `string` | yes | User identity to scope the lookup |
| `datasetId` | `string` | no | If provided, fetch only that dataset |

Routing behavior:

- if `userId` is present and `datasetId` is absent, return dataset list for the user
- if both `userId` and `datasetId` are present, return that dataset only if ownership matches

### Variant A: list datasets for user

Request example:

```http
GET /api/workforce-datasets?userId=user_demo_001
```

Success status code:

```text
200 OK
```

Success body:

```json
{
  "status": "success",
  "userId": "user_demo_001",
  "datasets": [
    {
      "datasetId": "wf_20260627101500_input-data_ab12cd34",
      "ownerUserId": "user_demo_001",
      "label": "April workforce workbook",
      "dbFileName": "wf_20260627101500_input-data_ab12cd34.db",
      "originalFileName": "input_data.xlsx",
      "workbookVersion": "v1",
      "createdAt": "2026-06-27T10:15:00+05:30",
      "importCounts": {
        "Person": 120,
        "Opportunity": 14
      },
      "conversationIds": [
        "conv-001"
      ]
    }
  ]
}
```

Response fields:

| Field | Type | Description |
| --- | --- | --- |
| `status` | `"success"` | Envelope status |
| `userId` | `string` | User whose datasets were returned |
| `datasets` | `WorkforceDatasetClientRecord[]` | User-owned datasets sorted newest first |

### Variant B: get a single dataset for user

Request example:

```http
GET /api/workforce-datasets?userId=user_demo_001&datasetId=wf_20260627101500_input-data_ab12cd34
```

Success status code:

```text
200 OK
```

Success body:

```json
{
  "status": "success",
  "dataset": {
    "datasetId": "wf_20260627101500_input-data_ab12cd34",
    "ownerUserId": "user_demo_001",
    "label": "April workforce workbook",
    "dbFileName": "wf_20260627101500_input-data_ab12cd34.db",
    "originalFileName": "input_data.xlsx",
    "workbookVersion": "v1",
    "createdAt": "2026-06-27T10:15:00+05:30",
    "importCounts": {
      "Person": 120,
      "Opportunity": 14
    },
    "conversationIds": [
      "conv-001"
    ]
  },
  "mastraInput": {
    "datasetId": "wf_20260627101500_input-data_ab12cd34"
  }
}
```

Response fields:

| Field | Type | Description |
| --- | --- | --- |
| `status` | `"success"` | Envelope status |
| `dataset` | `WorkforceDatasetClientRecord` | Requested dataset |
| `mastraInput` | `{ datasetId: string }` | Convenience handoff for downstream Mastra usage |

### Failure responses

Missing `userId`:

```text
400 Bad Request
```

```json
{
  "status": "failure",
  "error": "userId is required."
}
```

Unknown user, missing dataset, or dataset not owned by the user:

```text
404 Not Found
```

Example response:

```json
{
  "status": "failure",
  "error": "Dataset not found: wf_missing"
}
```

Other possible `error` messages:

- `User not found: <userId>`
- `Dataset <datasetId> does not belong to user <userId>.`

### Notes

- User list responses are filtered to that user only.
- Dataset lookup enforces ownership before returning metadata.
- The list response does not include DB file paths or Excel file paths.

## Endpoint: `PATCH /api/workforce-datasets`

Attach a conversation ID to an existing dataset owned by a user.

### Request

Headers:

```http
Content-Type: application/json
```

Body schema:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `datasetId` | `string` | yes | Dataset to update |
| `conversationId` | `string` | yes | Conversation ID to add |
| `userId` | `string` | yes | Owning user ID used for authorization |

Example request:

```json
{
  "datasetId": "wf_20260627101500_input-data_ab12cd34",
  "conversationId": "conv-002",
  "userId": "user_demo_001"
}
```

Behavior:

- Input strings are trimmed.
- If `conversationId` is already present on the dataset, it is not duplicated.
- Ownership is checked before modification.

### Success response

Status code:

```text
200 OK
```

Body:

```json
{
  "status": "success",
  "dataset": {
    "datasetId": "wf_20260627101500_input-data_ab12cd34",
    "ownerUserId": "user_demo_001",
    "label": "April workforce workbook",
    "dbFileName": "wf_20260627101500_input-data_ab12cd34.db",
    "originalFileName": "input_data.xlsx",
    "workbookVersion": "v1",
    "createdAt": "2026-06-27T10:15:00+05:30",
    "importCounts": {
      "Person": 120,
      "Opportunity": 14
    },
    "conversationIds": [
      "conv-001",
      "conv-002"
    ]
  },
  "mastraInput": {
    "datasetId": "wf_20260627101500_input-data_ab12cd34"
  }
}
```

### Failure responses

Missing required fields:

```text
400 Bad Request
```

```json
{
  "status": "failure",
  "error": "datasetId, conversationId, and userId are required."
}
```

Other handler failures:

```text
400 Bad Request
```

Example response:

```json
{
  "status": "failure",
  "error": "Dataset wf_20260627101500_input-data_ab12cd34 does not belong to user user_alice_001."
}
```

Other possible `error` messages:

- `User not found: <userId>`
- `Dataset not found: <datasetId>`
- `Failed to update dataset.`

## Endpoint: `GET /api/workforce-datasets/raw`

Return a source-workbook preview for a user-owned dataset.

This endpoint reads raw source rows from the generated SQLite database. It is intended for dashboard inspection and auditability, not for planning calculations.

### Request

Query parameters:

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `userId` | `string` | yes | User identity used for dataset ownership validation |
| `datasetId` | `string` | yes | Dataset to query |
| `sheet` | `string` | no | Workbook sheet to preview; defaults to the first imported sheet when omitted or unmatched |
| `limit` | `number` | no | Number of rows to return; defaults to `50` and is capped at `200` |
| `offset` | `number` | no | Zero-based row offset; defaults to `0` |

Behavior:

- validates dataset ownership through the same user and dataset metadata used by other dataset endpoints
- opens the dataset SQLite DB in read-only mode
- lists available sheets from `RawSheetRow`
- returns raw row metadata plus parsed `payloadJson`
- caps `limit` to avoid loading the full workbook into the dashboard preview

Request example:

```http
GET /api/workforce-datasets/raw?userId=user_demo_001&datasetId=wf_20260627101500_input-data_ab12cd34&sheet=People&limit=50
```

### Success response

Status code:

```text
200 OK
```

Body shape:

```json
{
  "status": "success",
  "dataset": {
    "datasetId": "wf_20260627101500_input-data_ab12cd34",
    "originalFileName": "input_data.xlsx"
  },
  "sheets": [
    {
      "sheetName": "People",
      "rows": 500
    }
  ],
  "selectedSheetName": "People",
  "limit": 50,
  "offset": 0,
  "rows": [
    {
      "sourceRowNumber": 2,
      "naturalKey": "EMP-001",
      "payload": {
        "Employee_ID": "EMP-001",
        "Name": "Example Person"
      }
    }
  ]
}
```

Response notes:

- `dataset` uses the `WorkforceDatasetClientRecord` shape; the example above is shortened to show the fields most relevant to the preview.

### Failure responses

Missing required query parameters, unknown user, unknown dataset, ownership failure, or unexpected raw-preview failure:

```text
400 Bad Request
```

```json
{
  "status": "failure",
  "error": "userId and datasetId are required."
}
```

Missing generated SQLite database:

```text
404 Not Found
```

```json
{
  "status": "failure",
  "error": "Dataset database not found."
}
```

## Endpoint: `GET /api/workforce-datasets/download`

Download the original uploaded `.xlsx` workbook for a user-owned dataset.

Unlike most endpoints, the success response is a binary workbook attachment instead of JSON.

### Request

Query parameters:

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `userId` | `string` | yes | User identity used for dataset ownership validation |
| `datasetId` | `string` | yes | Dataset whose original workbook should be downloaded |

Request example:

```http
GET /api/workforce-datasets/download?userId=user_demo_001&datasetId=wf_20260627101500_input-data_ab12cd34
```

### Success response

Status code:

```text
200 OK
```

Headers:

```http
Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
Content-Disposition: attachment; filename="<original workbook name>"
Cache-Control: no-store
```

Body:

```text
Binary .xlsx content
```

### Failure responses

Missing required query parameters, unknown user, unknown dataset, ownership failure, or unexpected download failure:

```text
400 Bad Request
```

```json
{
  "status": "failure",
  "error": "userId and datasetId are required."
}
```

Missing stored workbook file:

```text
404 Not Found
```

```json
{
  "status": "failure",
  "error": "Workbook file not found."
}
```

## Endpoint: `GET /api/workforce-datasets/dashboard`

Return the combined static dashboard payload for a user-owned workforce dataset.

Precedence rule:

- This endpoint family is implemented from `docs/static-dashboard-api-requirements.md`.
- If older notes or examples disagree, the dashboard requirements document takes precedence.

### Request

Query parameters:

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `userId` | `string` | yes | User identity used for dataset ownership validation |
| `datasetId` | `string` | yes | Dataset to query |

Behavior:

- validates that both query parameters are present after trimming
- treats unknown user IDs as dataset lookup failures
- rejects cross-user access even if the dataset exists
- serves `dataset.json.staticDashboard.sections` when the snapshot is already present
- backfills the snapshot once from the generated SQLite DB only when older datasets do not have `staticDashboard` yet
- does not require the SQLite DB after a valid static dashboard snapshot has already been stored

Recommended frontend usage:

- use this combined endpoint for the MVP static dashboard
- switch to the per-section endpoints later only if payload size or refresh cadence requires it

Request example:

```http
GET /api/workforce-datasets/dashboard?userId=user_demo_001&datasetId=wf_20260627101500_input-data_ab12cd34
```

### Success response

Status code:

```text
200 OK
```

Body shape:

```json
{
  "status": "success",
  "summary": {
    "datasetId": "wf_20260627101500_input-data_ab12cd34",
    "sourceName": "input_data.xlsx",
    "importedAt": "2026-06-27T10:15:00+00:00",
    "kpis": {
      "people": 500,
      "opportunities": 15,
      "roles": 60,
      "requiredFte": 53.4,
      "availableFteCurrent": 44.0,
      "currentBenchPeople": 30,
      "partialCapacityPeople": 40,
      "highRiskSupplyPeople": 24,
      "pendingEwaRequests": 34,
      "feasibleRoles": 35,
      "totalRoles": 60,
      "noDirectFitPeople": 23,
      "noDirectFitFte": 20.0
    }
  },
  "supply": {
    "availabilityByCategory": [],
    "benchMovement": [],
    "supplyRiskByCategory": [],
    "peopleByDiscipline": [],
    "peopleByLocation": [],
    "highRiskPeople": []
  },
  "demand": {
    "demandByStage": [],
    "demandByRole": [],
    "deliveryRiskByPriority": [],
    "topOpportunities": []
  },
  "staffingFit": {
    "fitDistribution": [],
    "topCandidatePerRole": [],
    "rolesWithoutFeasibleCandidate": [],
    "candidateOverlap": []
  },
  "skills": {
    "requiredSkillDemand": [],
    "skillSupply": [],
    "skillGaps": []
  },
  "ewa": {
    "ewaByStatus": [],
    "ewaQueue": [],
    "actionRequired": []
  }
}
```

Response notes:

- `summary` carries the dataset metadata and headline KPIs the dashboard header needs
- the combined payload is stored and served from `dataset.json.staticDashboard.sections`
- `supply.availabilityByCategory.availableFte` is aggregated from `SupplyRecord.supplyFte`
- `supply.peopleByDiscipline` and `supply.peopleByLocation` use current snapshot availability from `PersonAvailabilitySnapshot.availableFteCurrent`
- `summary.feasibleRoles` counts distinct roles that have at least one zero-gap candidate whose `fitStatus` starts with `Recommended` or `Backup`
- `staffingFit.rolesWithoutFeasibleCandidate` returns roles that do not have a zero-gap `Recommended*` or `Backup*` candidate
- `skills.skillGaps` includes only positive required-skill gaps

### Failure responses

Missing required query parameters:

```text
400 Bad Request
```

```json
{
  "status": "failure",
  "error": "userId and datasetId are required."
}
```

Unknown user, missing dataset metadata, or a legacy dataset that has neither a cached dashboard snapshot nor a readable dataset DB file:

```text
404 Not Found
```

```json
{
  "status": "failure",
  "error": "Dataset not found."
}
```

Ownership failure:

```text
403 Forbidden
```

```json
{
  "status": "failure",
  "error": "Dataset does not belong to user."
}
```

Unexpected dashboard query or handler failure:

```text
500 Internal Server Error
```

```json
{
  "status": "failure",
  "error": "Failed to build dashboard data."
}
```

## Endpoint Group: `GET /api/workforce-datasets/dashboard/<section>`

Return one dashboard section without the combined wrapper.

These endpoints read from the same persisted `dataset.json.staticDashboard.sections` snapshot as the combined endpoint.

### Supported section paths

| Path | Success body fields |
| --- | --- |
| `/api/workforce-datasets/dashboard/summary` | `status`, `datasetId`, `sourceName`, `importedAt`, `kpis` |
| `/api/workforce-datasets/dashboard/supply` | `status`, `availabilityByCategory`, `benchMovement`, `supplyRiskByCategory`, `peopleByDiscipline`, `peopleByLocation`, `highRiskPeople` |
| `/api/workforce-datasets/dashboard/demand` | `status`, `demandByStage`, `demandByRole`, `deliveryRiskByPriority`, `topOpportunities` |
| `/api/workforce-datasets/dashboard/staffing-fit` | `status`, `fitDistribution`, `topCandidatePerRole`, `rolesWithoutFeasibleCandidate`, `candidateOverlap` |
| `/api/workforce-datasets/dashboard/skills` | `status`, `requiredSkillDemand`, `skillSupply`, `skillGaps` |
| `/api/workforce-datasets/dashboard/skills/gaps` | `status`, `skillGaps` |
| `/api/workforce-datasets/dashboard/ewa` | `status`, `ewaByStatus`, `ewaQueue`, `actionRequired` |

### Request

Query parameters are identical to the combined endpoint:

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `userId` | `string` | yes | User identity used for dataset ownership validation |
| `datasetId` | `string` | yes | Dataset to query |

Example request:

```http
GET /api/workforce-datasets/dashboard/summary?userId=user_demo_001&datasetId=wf_20260627101500_input-data_ab12cd34
```

Skill gaps only:

```http
GET /api/workforce-datasets/dashboard/skills/gaps?userId=user_demo_001&datasetId=wf_20260627101500_input-data_ab12cd34
```

```json
{
  "status": "success",
  "skillGaps": [
    {
      "skillName": "Accessibility",
      "requiredRoles": 1,
      "people": 0,
      "gap": 1
    }
  ]
}
```

### Success response example

```json
{
  "status": "success",
  "datasetId": "wf_20260627101500_input-data_ab12cd34",
  "sourceName": "input_data.xlsx",
  "importedAt": "2026-06-27T10:15:00+00:00",
  "kpis": {
    "people": 500,
    "opportunities": 15,
    "roles": 60,
    "requiredFte": 53.4,
    "availableFteCurrent": 44.0,
    "currentBenchPeople": 30,
    "partialCapacityPeople": 40,
    "highRiskSupplyPeople": 24,
    "pendingEwaRequests": 34,
    "feasibleRoles": 35,
    "totalRoles": 60,
    "noDirectFitPeople": 23,
    "noDirectFitFte": 20.0
  }
}
```

### Failure responses

The same validation and error shapes as the combined dashboard endpoint apply here.

Unsupported section path:

```text
404 Not Found
```

```json
{
  "status": "failure",
  "error": "API route not found."
}
```

## Endpoint: `POST /api/workforce-chat`

Answer one workspace chat question using workforce-planning evidence.

The current workspace chat handler calls tool functions directly from `backend/src/mastra/tools`. The only registered Mastra agent is the Workforce Router Agent. The legacy `agentsUsed` response field names the Workforce Router Agent plus logical tools represented by the evidence, not multiple executed `Agent` instances. The endpoint returns chat-visible text plus per-message detail JSON for the workspace right panel.

Current runtime path used by this endpoint:

- `assessOpportunity()`
- `findResourceSupply()`
- `buildTeamOptions()`
- `buildWorkforceDashboardSkillGaps()`

Implemented router and specialist tool paths:

- `workforceRouterAgent` / `workforceRouterTool` / `routeWorkforceQuestion()`
- `riskInsightsTool` / `buildRiskInsights()`
- `approvalDecisionTool` / `buildApprovalDecision()`

The backend first builds deterministic JSON evidence from the dataset. If `OPENAI_API_KEY` is configured, OpenAI writes the concise chat-facing `message` from that evidence. If no key is configured, the endpoint returns a deterministic fallback message.

### Request

```http
POST /api/workforce-chat
Content-Type: application/json
```

```json
{
  "userId": "user_demo_001",
  "datasetId": "wf_20260627101500_input-data_ab12cd34",
  "message": "Who can staff the highest priority opportunity?"
}
```

### Success Response

```json
{
  "status": "success",
  "conversationId": "chat_00000000-0000-0000-0000-000000000000",
  "message": "Chat-visible answer generated from tool evidence.",
  "detailView": "staffing-fit",
  "details": {
    "view": "staffing-fit",
    "title": "Staffing Fit Evidence",
    "summary": "Balanced Team: 3.5/4.0 FTE assigned with 0.5 FTE remaining gap.",
    "cards": [],
    "charts": [],
    "tables": [],
    "json": {
      "opportunityAssessment": {},
      "resourceSupply": {},
      "teamBuilder": {},
      "skillGaps": []
    }
  },
  "agentsUsed": [
    "workforce-router-agent",
    "opportunity-assessment-tool",
    "resource-supply-tool",
    "team-builder-tool"
  ]
}
```

Frontend rule:

- Display only `message` in the chat bubble.
- Attach `details` to the same assistant message.
- Show `View details` when `detailView` and `details` are present.
- Render the right-side workspace panel from `details.cards`, `details.charts`, and `details.tables`.
- Supported current `detailView` values are `overview`, `staffing-fit`, `supply-risk`, `skill-gaps`, and `demand`.
- If the route cannot safely infer the target opportunity, return a clarification `message`, `needsClarification: true`, and no detail panel.
- EWA, approval, blocker, risk-insight, and final recommendation questions require `workforceRouterTool`, `riskInsightsTool`, and `approvalDecisionTool` before the frontend should show those as supported chat paths.

### Failure Responses

The same common failure envelope applies:

```json
{
  "status": "failure",
  "error": "userId and datasetId are required."
}
```

## Request Flow Guidance

Recommended frontend sequence:

1. Call `POST /api/auth/login`
2. Persist the returned `userId`
3. Call `POST /api/workforce-datasets` with workbook file and `userId`
4. Persist the returned `datasetId`
5. Use `GET /api/workforce-datasets?userId=...` to list datasets for that user
6. Use `GET /api/workforce-datasets?userId=...&datasetId=...` when details for one dataset are needed
7. Use `PATCH /api/workforce-datasets` to attach later conversation IDs
8. Use `GET /api/workforce-datasets/dashboard?userId=...&datasetId=...` to load the cached static dashboard
9. Use `GET /api/workforce-datasets/dashboard/<section>?userId=...&datasetId=...` only when incremental section refresh is needed
10. Use `GET /api/workforce-datasets/raw?userId=...&datasetId=...` when the dashboard raw Excel preview is opened
11. Use `GET /api/workforce-datasets/download?userId=...&datasetId=...` when the user downloads the original workbook
12. Use `POST /api/workforce-chat` for workspace chat answers and per-message detail JSON

## Future Contract Update Rules

When a new API endpoint is added:

1. Add it to the `Current API surface` list at the top of this file.
2. Add a dedicated endpoint section with:
   - purpose
   - method and path
   - headers
   - query parameters
   - request body schema
   - success response schema
   - failure response schema
   - status codes
   - side effects
3. Add any new shared data model under `Shared Data Models`.
4. Update any flow documentation affected by the new endpoint.
5. Keep examples aligned with the real handler implementation.

## Source Of Truth In Code

Primary route handlers:

- `src/next/auth-login-route.ts`
- `src/next/workforce-datasets-route.ts`
- `src/next/workforce-dashboard-route.ts`
- `src/next/workforce-chat-route.ts`

Primary workforce tools:

- `src/mastra/tools/workforce-router-tool.ts`
- `src/mastra/tools/opportunity-assessment-tool.ts`
- `src/mastra/tools/resource-supply-tool.ts`
- `src/mastra/tools/team-builder-tool.ts`
- `src/mastra/tools/risk-insights-tool.ts`
- `src/mastra/tools/approval-decision-tool.ts`

Next.js route entry points:

- `src/app/api/[...path]/route.ts`
