# Team Builder Tool Contract

## Purpose

Build role-wise candidate pools and team-level staffing options from opportunity demand and resource supply evidence.

## Tool Source

- Tool: `teamBuilderTool`
- Source schema: `teamBuilderOutputSchema`

## Response JSON

```json
{
  "source": {
    "datasetId": "string | null",
    "dbPath": "string",
    "retrievedAtIso": "string"
  },
  "asOfDate": "YYYY-MM-DD",
  "opportunity": {
    "id": "string",
    "name": "string",
    "clientName": "string",
    "clientType": "string",
    "domain": "string",
    "region": "string",
    "country": "string",
    "city": "string",
    "stage": "string",
    "probability": 0,
    "expectedStartDate": "YYYY-MM-DD",
    "durationWeeks": 0,
    "commercialPriority": "string",
    "deliveryRisk": "string",
    "opportunityBrief": "string",
    "timezonePreference": "string"
  },
  "roleWiseCandidates": [
    {
      "roleId": "string",
      "roleName": "string",
      "fteRequired": 0,
      "minimumIndividualFte": 0,
      "canCombineCandidates": false,
      "candidates": [
        {
          "roleId": "string",
          "roleName": "string",
          "personId": "string",
          "name": "string",
          "grade": "string",
          "discipline": "string",
          "roleArchetype": "string",
          "city": "string",
          "country": "string",
          "primaryDomain": "string",
          "source": "strict | near-match",
          "feasibility": "feasible | partial-capacity | below-minimum-capacity | availability-blocked | ewa-blocked",
          "availableFteInWindow": 0,
          "assignmentFte": 0,
          "fteGap": 0,
          "capabilityScore": 0,
          "availabilityScore": 0,
          "overallScore": 0,
          "skillMatchScore": 0,
          "overlayScore": 0,
          "overlayRank": 0,
          "fitStatus": "string | null",
          "ewaStatus": "string",
          "evidence": ["string"]
        }
      ],
      "outcome": "string"
    }
  ],
  "teamOptions": [
    {
      "optionType": "Best Fit Team | Fastest Available Team | Balanced Team",
      "summary": "string",
      "totalFteRequired": 0,
      "assignedFte": 0,
      "remainingFteGap": 0,
      "averageOverallScore": 0,
      "confidence": "High | Medium | Low",
      "assignments": [
        {
          "roleId": "string",
          "roleName": "string",
          "personId": "string",
          "name": "string",
          "assignmentFte": 0,
          "feasibility": "string",
          "overallScore": 0,
          "evidence": ["string"]
        }
      ],
      "gaps": ["string"],
      "evidence": ["string"]
    }
  ],
  "constraints": ["string"],
  "evidence": ["string"]
}
```

## Notes

- Produces three standard team options: Best Fit, Fastest Available, and Balanced.
- Respects `minimumIndividualFte` and `canCombineCandidates`.
- Does not create approval decisions or EWA bookings.
