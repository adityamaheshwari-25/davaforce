# Opportunity Assessment Tool Contract

## Purpose

Normalize staffing demand from a user query or existing opportunity record into a structured opportunity requirement package.

## Tool Source

- Tool: `opportunityAssessmentTool`
- Source schema: `opportunityAssessmentOutputSchema`

## Response JSON

```json
{
  "source": {
    "datasetId": "string | null",
    "dbPath": "string",
    "retrievedAtIso": "string"
  },
  "asOfDate": "YYYY-MM-DD",
  "selectedOpportunityId": "string | null",
  "selectionReason": "string",
  "selectionDiagnostics": {
    "strategy": "explicit-id | query-match | highest-probability",
    "queryTokens": ["string"],
    "candidateOpportunities": [
      {
        "id": "string",
        "name": "string",
        "clientName": "string",
        "domain": "string",
        "region": "string",
        "country": "string",
        "stage": "string",
        "probability": 0,
        "expectedStartDate": "YYYY-MM-DD",
        "durationWeeks": 0,
        "commercialPriority": "string",
        "deliveryRisk": "string",
        "matchedQueryTokens": ["string"],
        "queryTokenHits": 0,
        "selectionScore": 0,
        "selectionReason": "string"
      }
    ]
  },
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
  "roles": [
    {
      "id": "string",
      "opportunityId": "string",
      "roleName": "string",
      "disciplineOrDepartment": "string",
      "gradePreference": "string",
      "requiredSkills": ["string"],
      "desiredSkills": ["string"],
      "domainExperienceRequired": "string",
      "locationPreference": "string",
      "startDate": "YYYY-MM-DD",
      "durationWeeks": 0,
      "fteRequired": 0,
      "priority": "string",
      "flexibilityNotes": "string",
      "minimumIndividualFte": 0,
      "canCombineCandidates": false
    }
  ],
  "rolePrioritization": [
    {
      "priorityOrder": 1,
      "roleId": "string",
      "roleName": "string",
      "fteRequired": 0,
      "canCombineCandidates": false,
      "priority": "string",
      "reason": "string"
    }
  ],
  "normalizedRequirements": {
    "requiredRoles": ["string"],
    "requiredSkills": ["string"],
    "desiredSkills": ["string"],
    "grades": ["string"],
    "locations": ["string"],
    "domain": "string | null",
    "startDate": "YYYY-MM-DD | null",
    "durationWeeks": 0,
    "totalFteRequired": 0
  },
  "extractedQuerySignals": {
    "skills": ["string"],
    "locations": ["string"],
    "availabilityWindowDays": 0,
    "roleHints": ["string"]
  },
  "missingFields": ["string"],
  "evidence": ["string"]
}
```

## Notes

- This tool must not recommend candidates or teams.
- Confirmed DB requirements stay separate from extracted query signals.
- `opportunity` can be `null` when no opportunity is selected.
