import { createFileRoute } from "@tanstack/react-router";
import { DriverTachographModal, usePendingTachoRequests } from "@/components/driver/DriverTachographModal";

export const Route = createFileRoute("/d/tachograph")({
  head: () => ({ meta: [{ title: "Tachograph — Driver" }] }),
  component: TachoPage,
});

function TachoPage() {
  const { pending } = usePendingTachoRequests();
  return (
    <div className="pt-6 px-4 pb-10">
      <h1 className="text-2xl font-bold mb-2 text-foreground">Tachograph hours</h1>
      {pending.length === 0 ? (
        <p className="text-sm text-muted-foreground">You are all caught up — no hours to submit.</p>
      ) : (
        <p className="text-sm text-muted-foreground">You have {pending.length} week(s) to confirm below.</p>
      )}
      <DriverTachographModal />
    </div>
  );
}
