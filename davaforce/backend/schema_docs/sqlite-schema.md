# Workforce SQLite Schema

This project loads `input_data.xlsx` into a SQLite database at [prisma/workforce.db](/C:/Users/sgururaj/Documents/analyzexcel/prisma/workforce.db) using the Prisma schema in [prisma/schema.prisma](/C:/Users/sgururaj/Documents/analyzexcel/prisma/schema.prisma).
For a deeper explanation of the modeling decisions and each table, see [docs/schema-deep-dive.md](/C:/Users/sgururaj/Documents/analyzexcel/docs/schema-deep-dive.md).

## Files

- Importer: [scripts/import_excel_to_sqlite.py](/C:/Users/sgururaj/Documents/analyzexcel/scripts/import_excel_to_sqlite.py)
- Prisma schema: [prisma/schema.prisma](/C:/Users/sgururaj/Documents/analyzexcel/prisma/schema.prisma)
- SQLite database: [prisma/workforce.db](/C:/Users/sgururaj/Documents/analyzexcel/prisma/workforce.db)

## Import Command

```powershell
py -3 scripts\import_excel_to_sqlite.py --replace
```

## Design Notes

- Every non-empty workbook row is preserved in `RawSheetRow` as JSON, including metadata sheets. The static dashboard raw Excel preview reads from this table.
- Canonical tables are created for the workforce planning sheets used by the assistant and workbench.
- Date fields are stored as ISO `YYYY-MM-DD` strings so Prisma and SQLite can read them consistently without timezone conversion.
- `CurrentAllocation` is intentionally flattened. The workbook reuses `AccountID`, `ProjectID`, and `Client_Type` with conflicting meanings, so they are not modeled as separate dimensions.
- `OpportunityRole` keeps the original semicolon-delimited skill fields and also expands them into `OpportunityRoleSkillRequirement`.
- `PartialCapacityView` is loaded even though it is a derived workbook view, because the workbook exposes it as a separate sheet.

## Tables

### Provenance

- `ImportBatch`
  Stores workbook import metadata.
- `RawSheetRow`
  Stores one JSON payload per source row with `sheetName`, `sourceRowNumber`, `naturalKey`, and `rowHash`. Use it for import auditability and source preview, while planning calculations should prefer canonical tables.

### Workforce Supply

- `Person`
  Base employee identity and org attributes from `People`.
- `PersonAvailabilitySnapshot`
  Current availability snapshot from `People`, including release date, available FTE, and current booking status.
- `Profile`
  Narrative profile details from `Profiles`.
- `SkillCatalog`
  Canonical skill catalog from `Skill Catalog`.
- `PersonSkillEvidence`
  Employee-skill evidence rows from `Skills`.
- `CurrentAllocation`
  Flattened current assignment row from `Allocations`, including `accountId`, `clientName`, `clientType`, `projectId`, `projectName`, and `domain`.
- `SupplyRecord`
  Canonical supply pipeline row from `Bench`, covering current bench, future roll-off, and partial capacity.
- `PartialCapacityView`
  Derived partial-capacity subset from `Partial Capacity`.
- `AvailabilityWeek`
  Weekly availability fact rows from `Availability Calendar`.
- `BenchMovementWeek`
  Weekly aggregate bench movement rows from `Bench Movement`.
- `ProjectHistory`
  Historical delivery evidence from `Project History`.

### Demand and Staffing

- `Opportunity`
  Opportunity demand header from `Opportunities`.
- `OpportunityRole`
  Role demand rows from `Opportunity Roles`.
- `OpportunityRoleSkillRequirement`
  Exploded `REQUIRED` and `DESIRED` skill rows derived from the semicolon-delimited role skill columns.
- `OpportunityCandidateOverlay`
  Evidence-based role-candidate ranking rows from `Opportunity Overlays`.
- `EwaRequest`
  Booking workflow rows from `EWA Requests`. This is the source of truth for booking status.
- `ScenarioTarget`
  Planning scenario targets from `Scenario Targets`.

## Key Relationships

- `Profile.personId -> Person.id`
- `PersonSkillEvidence.personId -> Person.id`
- `PersonSkillEvidence.skillName -> SkillCatalog.name`
- `PersonAvailabilitySnapshot.personId -> Person.id`
- `CurrentAllocation.personId -> Person.id`
- `SupplyRecord.personId -> Person.id`
- `PartialCapacityView.personId -> Person.id`
- `PartialCapacityView.sourceBenchRecordId -> SupplyRecord.id`
- `AvailabilityWeek.personId -> Person.id`
- `ProjectHistory.personId -> Person.id`
- `OpportunityRole.opportunityId -> Opportunity.id`
- `OpportunityRoleSkillRequirement.opportunityRoleId -> OpportunityRole.id`
- `OpportunityRoleSkillRequirement.skillName -> SkillCatalog.name`
- `OpportunityCandidateOverlay.opportunityId -> Opportunity.id`
- `OpportunityCandidateOverlay.opportunityRoleId -> OpportunityRole.id`
- `OpportunityCandidateOverlay.personId -> Person.id`
- `EwaRequest.opportunityId -> Opportunity.id`
- `EwaRequest.opportunityRoleId -> OpportunityRole.id`
- `EwaRequest.personId -> Person.id`

## Row Counts From Current Workbook

- `Person`: 500
- `PersonAvailabilitySnapshot`: 500
- `Profile`: 500
- `SkillCatalog`: 125
- `PersonSkillEvidence`: 1500
- `CurrentAllocation`: 500
- `SupplyRecord`: 130
- `PartialCapacityView`: 40
- `AvailabilityWeek`: 6000
- `BenchMovementWeek`: 12
- `ProjectHistory`: 418
- `Opportunity`: 15
- `OpportunityRole`: 60
- `OpportunityRoleSkillRequirement`: 272
- `OpportunityCandidateOverlay`: 180
- `EwaRequest`: 120
- `ScenarioTarget`: 6
- `RawSheetRow`: 10432
