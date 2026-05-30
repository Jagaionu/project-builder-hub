/**
 * AuditPlanButton.tsx
 *
 * Drop this button into the Dispatch page toolbar, next to the Plan button.
 *
 * It calls auditPlan() (read-only — writes nothing to DB), then downloads
 * the result as a timestamped JSON file you can open and compare across runs.
 *
 * Usage in _app.dispatch.tsx:
 *
 *   import { AuditPlanButton } from "@/components/dispatch/AuditPlanButton";
 *   // In the toolbar, after the Plan button:
 *   <AuditPlanButton />
 */

import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { auditPlan } from "@/lib/audit-plan.functions";
import { ToolbarButton } from "@/components/dispatch/toolbar";

function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function AuditPlanButton() {
  const runAudit = useServerFn(auditPlan);
  const [running, setRunning] = useState(false);

  async function handleAudit() {
    if (running) return;
    setRunning(true);
    try {
      const report = await runAudit();
      const filename = `plan-audit-${report.audit_run_at.replace(/[:.]/g, "-")}.json`;
      downloadJson(report, filename);
      toast.success(
        `Audit downloaded · ${report.summary.total_assigned} assigned, ` +
        `${report.summary.total_unassignable} unassignable`,
      );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <ToolbarButton onClick={handleAudit} disabled={running} title="Download planning audit (read-only, no DB writes)">
      {running ? "Auditing…" : "Audit Plan"}
    </ToolbarButton>
  );
}
