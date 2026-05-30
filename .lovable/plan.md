## Add Audit Plan Button to Dispatch Page

Create an `AuditPlanButton` component that calls the existing `auditPlan` server function and downloads the resulting JSON report. Place it in the dispatch toolbar, immediately to the right of the existing "Plan" button.

### Files changed
1. `src/components/dispatch/audit-plan-button.tsx` — new component wrapping `ToolbarButton` + `auditPlan` server function. On click it runs the audit and triggers a browser download of the JSON report.
2. `src/routes/_app.dispatch.tsx` — import the new component and insert `<AuditPlanButton />` next to the Plan button in the toolbar.

No database or schema changes.