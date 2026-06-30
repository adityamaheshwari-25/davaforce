# Approval & Decision Tool Contract

## Purpose

Prepare the final human approval package using selected staffing option, risk insights, and EWA request status.

## Tool Source

- Tool: `approvalDecisionTool`
- Source schema: `approvalDecisionOutputSchema`

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
  "selectedOptionType": "string | null",
  "decisionState": "Ready for Human Approval Review | Needs Planner Review Before Approval | No Recommendation Available",
  "readyForApproval": false,
  "humanApprovalRequired": true,
  "recommendationSummary": "string",
  "selectedOption": {
    "optionType": "string",
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
  },
  "riskSummary": {
    "overallRiskLevel": "High | Medium | Low",
    "overallConfidence": "High | Medium | Low",
    "optionRiskLevel": "High | Medium | Low | null",
    "optionRiskScore": 0,
    "keyRisks": [
      {
        "category": "string",
        "severity": "High | Medium | Low",
        "scope": "string",
        "message": "string",
        "evidence": ["string"]
      }
    ]
  },
  "approvalChecklist": [
    {
      "item": "string",
      "status": "Pass | Review | Blocker",
      "notes": ["string"]
    }
  ],
  "ewaSummary": {
    "totalRequests": 0,
    "requestsByStatus": {
      "Blocked": 0
    },
    "blockers": [
      {
        "roleId": "string",
        "roleName": "string",
        "personId": "string",
        "personName": "string",
        "requestType": "string",
        "ewaStatus": "string",
        "requestedFte": 0,
        "proposedStartDate": "YYYY-MM-DD",
        "proposedEndDate": "YYYY-MM-DD",
        "approvalRequired": false,
        "blockingReason": "string",
        "nextAction": "string"
      }
    ],
    "requestsForSelectedOption": [
      "same shape as blockers"
    ]
  },
  "approvalPackage": {
    "approverAudience": ["string"],
    "decisionPrompt": "string",
    "recommendedDecision": "string",
    "conditions": ["string"]
  },
  "nextActions": ["string"],
  "evidence": ["string"]
}
```

## Notes

- This tool must never auto-approve staffing, booking, or EWA actions.
- `readyForApproval` means ready for human review, not approved.
- EWA requests are treated as the booking-status source of truth.
