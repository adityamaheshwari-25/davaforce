# Workforce Router Agent Contract

## Purpose

Route a user workforce planning question to the minimum required logical tool path and return the DB-backed JSON produced by deterministic tools.

## Tool Source

- Agent: `workforceRouterAgent`
- Tool: `workforceRouterTool`
- Source schema: `workforceRouterOutputSchema`

## Response JSON

```json
{
  "route": {
    "intent": "blocked | clarification | general | opportunity_assessment | resource_supply | team_builder | risk_insights | approval_decision",
    "confidence": "High | Medium | Low",
    "reason": "string",
    "executionMode": "tool_orchestrated | no_db_required | needs_context | blocked | clarification",
    "plannedAgentPath": ["string"],
    "agentsToRun": ["string"],
    "skippedAgents": ["string"],
    "executionPlan": [
      {
        "order": 1,
        "agent": "string",
        "purpose": "string",
        "dependsOn": ["string"]
      }
    ]
  },
  "opportunityAssessment": {
    "contract": "See opportunity-assessment-agent.md",
    "nullable": true
  },
  "resourceSupply": {
    "contract": "See resource-supply-agent.md",
    "nullable": true
  },
  "resourceSupplyByRole": [
    {
      "roleId": "string",
      "roleName": "string",
      "resourceSupply": {
        "contract": "See resource-supply-agent.md"
      }
    }
  ],
  "teamBuilder": {
    "contract": "See team-builder-agent.md",
    "nullable": true
  },
  "riskInsights": {
    "contract": "See risk-insights-agent.md",
    "nullable": true
  },
  "approvalDecision": {
    "contract": "See approval-decision-agent.md",
    "nullable": true
  },
  "finalResponseType": "general_message | needs_context_message | opportunity_assessment_json | resource_supply_json | team_builder_json | risk_insights_json | approval_decision_json",
  "message": "string",
  "evidence": ["string"]
}
```

## Intent Routing

| Intent | Produced Sections |
| --- | --- |
| `blocked` | none; returns unsafe-request guardrail `message` |
| `clarification` | none; returns clarification `message` |
| `general` | none; returns `message` only |
| `opportunity_assessment` | `opportunityAssessment` |
| `resource_supply` | `resourceSupply` |
| `team_builder` | `opportunityAssessment`, `resourceSupplyByRole`, `teamBuilder` |
| `risk_insights` | `opportunityAssessment`, `resourceSupplyByRole`, `teamBuilder`, `riskInsights` |
| `approval_decision` | `opportunityAssessment`, `resourceSupplyByRole`, `teamBuilder`, `riskInsights`, `approvalDecision` |

## Notes

- `plannedAgentPath` is the legacy field name for the logical specialist-tool path.
- `executionPlan[].agent`, `agentsToRun`, and `skippedAgents` are legacy field names; their values should name selected tools except for the Workforce Router Agent itself.
- `executionMode: "tool_orchestrated"` means deterministic tool functions produced the output.
- `executionMode: "no_db_required"` is used for generic greetings/help.
- `executionMode: "needs_context"` is used when the user asks a workforce question without `datasetId` or `dbPath`.
- `executionMode: "blocked"` is used for unsafe/out-of-scope actions such as modifying DB records, bypassing EWA, or auto-approving bookings.
- `executionMode: "clarification"` is used when intent confidence is too low to choose a route.
- Null sections are expected for tools that were not needed for the selected route.

## Output Guardrails

- No fabricated evidence: `message` and produced sections must come from deterministic router/tool output and supplied DB evidence. Missing facts remain null, empty, or unavailable rather than being inferred.
- No auto-approval language: output must not claim staffing was approved, booked, confirmed, completed, or auto-approved. Approval-related routes may only say that an approval package or human-review package was prepared.
- The `evidence` array includes output guardrail entries confirming that the response stayed evidence-backed and advisory.
