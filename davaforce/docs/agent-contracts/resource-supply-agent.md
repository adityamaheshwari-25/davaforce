# Resource Supply Tool Contract

## Purpose

Find workforce supply, availability, bench capacity, partial capacity, weekly bench movement, scenario target status, skill matches, near matches, and filter diagnostics.

## Tool Source

- Tool: `resourceSupplyTool`
- Source schema: `resourceSupplyOutputSchema`

## Response JSON

```json
{
  "source": {
    "datasetId": "string | null",
    "dbPath": "string",
    "retrievedAtIso": "string"
  },
  "filters": {
    "opportunityId": "string | null",
    "roleId": "string | null",
    "skills": ["string"],
    "roleName": "string | null",
    "discipline": "string | null",
    "grade": "string | null",
    "location": "string | null",
    "domain": "string | null",
    "asOfDate": "YYYY-MM-DD",
    "availabilityWindowDays": 0,
    "minFte": 0,
    "limit": 0
  },
  "summary": {
    "totalCandidates": 0,
    "currentBenchPeople": 0,
    "partialCapacityPeople": 0,
    "availableNowFte": 0,
    "availableInWindowFte": 0
  },
  "capacityByWindow": [
    {
      "window": "Current | 0-30 | 31-60 | 61-90 | Partial | string",
      "people": 0,
      "fte": 0
    }
  ],
  "benchMovement": [
    {
      "weekStartDate": "YYYY-MM-DD",
      "currentBenchHeadcount": 0,
      "emergingBenchHeadcount": 0,
      "partialCapacityHeadcount": 0,
      "availableFte": 0,
      "notes": "string"
    }
  ],
  "scenarioTargets": [
    {
      "id": "string",
      "scenarioName": "string",
      "targetDate": "YYYY-MM-DD",
      "targetBenchRate": 0,
      "targetBenchHeadcount": 0,
      "focus": "string",
      "successMeasure": "string",
      "nearestWeekStartDate": "YYYY-MM-DD | null",
      "currentBenchHeadcount": "0 | null",
      "currentBenchDelta": "0 | null",
      "status": "On or below target | Above target | No movement evidence"
    }
  ],
  "candidates": [
    {
      "personId": "string",
      "name": "string",
      "discipline": "string",
      "roleArchetype": "string",
      "grade": "string",
      "city": "string",
      "country": "string",
      "primaryDomain": "string",
      "availabilityCategory": "string",
      "releaseWindow": "string",
      "expectedReleaseDate": "YYYY-MM-DD | string",
      "availableFrom": "YYYY-MM-DD | null",
      "availableFteCurrent": 0,
      "supplyFte": 0,
      "availableFteInWindow": 0,
      "currentAllocationFte": 0,
      "ewaStatus": "string",
      "benchRisk": "string | null",
      "timeOnBenchDays": "0 | null",
      "matchedSkills": ["string"],
      "skillMatchCount": 0,
      "skillMatchScore": 0,
      "overlayScore": 0,
      "overlayRank": 0,
      "fitStatus": "string | null",
      "fteGap": 0,
      "evidence": ["string"]
    }
  ],
  "nearMatches": [
    "same shape as candidates"
  ],
  "filterDiagnostics": {
    "evaluated": 0,
    "afterAvailability": 0,
    "afterSkillsOrOverlay": 0,
    "afterLocation": 0,
    "afterDomain": 0,
    "afterGrade": 0,
    "afterDiscipline": 0,
    "strictMatches": 0
  },
  "risks": ["string"],
  "evidence": ["string"]
}
```

## Notes

- `candidates` are strict matches.
- `nearMatches` are returned when strict filters remove all useful candidates.
- This tool must not assemble final team options.
