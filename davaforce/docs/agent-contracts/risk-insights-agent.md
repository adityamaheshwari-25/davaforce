# Risk & Insights Tool Contract

## Purpose

Evaluate staffing options for risk, confidence, capability gaps, availability risks, regional capacity impact, utilization impact, and next actions.

## Tool Source

- Tool: `riskInsightsTool`
- Source schema: `riskInsightsOutputSchema`

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
  "overallRiskLevel": "High | Medium | Low",
  "overallConfidence": "High | Medium | Low",
  "summary": "string",
  "optionAnalyses": [
    {
      "optionType": "string",
      "riskLevel": "High | Medium | Low",
      "riskScore": 0,
      "confidence": "High | Medium | Low",
      "assignedFte": 0,
      "remainingFteGap": 0,
      "risks": [
        {
          "category": "FTE Gap | Availability | Capability | Relaxed Filter | string",
          "severity": "High | Medium | Low",
          "scope": "string",
          "message": "string",
          "evidence": ["string"]
        }
      ],
      "recommendedActions": ["string"]
    }
  ],
  "roleAnalyses": [
    {
      "roleId": "string",
      "roleName": "string",
      "riskLevel": "High | Medium | Low",
      "capabilityGapSummary": "string",
      "availabilityRiskSummary": "string",
      "bestCandidate": "string | null",
      "blockedCandidates": ["string"],
      "nextActions": ["string"]
    }
  ],
  "capabilityGaps": [
    "same shape as risk item"
  ],
  "availabilityRisks": [
    "same shape as risk item"
  ],
  "regionalCapacityImpact": [
    {
      "label": "string",
      "assignedFte": 0,
      "people": 0,
      "notes": ["string"]
    }
  ],
  "utilizationImpact": [
    {
      "label": "string",
      "assignedFte": 0,
      "people": 0,
      "notes": ["string"]
    }
  ],
  "nextActions": ["string"],
  "evidence": ["string"]
}
```

## Notes

- This tool evaluates and explains risk; it does not approve staffing.
- Capability and availability risks should be kept separate.
