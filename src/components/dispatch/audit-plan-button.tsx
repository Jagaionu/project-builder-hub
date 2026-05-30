import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ClipboardList } from "lucide-react";
import { ToolbarButton } from "./toolbar";
import { auditPlan } from "@/lib/audit-plan.functions";

export function AuditPlanButton() {
  const runAudit = useServerFn(auditPlan);
  const [busy, setBusy] = useState(false);

  async function onClick() {
    if (busy) return;
    setBusy(true);
    try {
      const report = await runAudit();
      const blob = new Blob([JSON.stringify(report, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `plan-audit-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(
        `Audit: ${report.summary.total_assigned}/${report.summary.total_pending_jobs} assigned`,
      );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ToolbarButton
      onClick={onClick}
      disabled={busy}
      title="Run planner in dry-run mode and download the decision trace"
      icon={<ClipboardList className="size-3.5" />}
    >
      {busy ? "Auditing…" : "Audit Plan"}
    </ToolbarButton>
  );
}
