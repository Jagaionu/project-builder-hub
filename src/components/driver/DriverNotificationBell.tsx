import { useState } from "react";
import { Bell, X } from "lucide-react";
import { useDriverNotifications } from "@/hooks/useDriverNotifications";

// Floating bell with unread count + a panel listing recent notifications.
// Mounting this also activates the realtime toast (the hook lives here).
export function DriverNotificationBell() {
  const { items, unread, markAllRead } = useDriverNotifications();
  const [open, setOpen] = useState(false);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) void markAllRead();
  };

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        aria-label="Notifications"
        className="fixed top-3 right-3 z-[1100] size-10 grid place-items-center rounded-full bg-card border border-border shadow-md active:scale-95 transition"
      >
        <Bell className="size-5 text-foreground" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 grid place-items-center rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="fixed inset-0 z-[1099]" onClick={() => setOpen(false)}>
          <div
            className="absolute top-14 right-3 w-[min(20rem,calc(100vw-1.5rem))] max-h-[70vh] overflow-y-auto rounded-2xl border border-border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <span className="font-semibold text-sm">Notifications</span>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close">
                <X className="size-4 text-muted-foreground" />
              </button>
            </div>
            {items.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                No notifications yet.
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {items.map((n) => (
                  <li key={n.id} className="px-4 py-3">
                    <div className="text-sm font-semibold text-foreground">{n.title}</div>
                    {n.body && <div className="text-xs text-muted-foreground mt-0.5">{n.body}</div>}
                    <div className="text-[10px] text-muted-foreground/70 mt-1 font-mono">
                      {new Date(n.created_at).toLocaleString(undefined, {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                        hour12: false,
                      })}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </>
  );
}
