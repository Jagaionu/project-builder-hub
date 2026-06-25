import { useState } from "react";

// Small tappable ? that toggles a short explanation (mobile-friendly).
export function InfoHint({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex align-middle">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="More info"
        className="inline-flex items-center justify-center size-4 rounded-full border border-muted-foreground/40 text-[10px] font-bold leading-none text-muted-foreground active:scale-90 transition"
      >
        ?
      </button>
      {open && (
        <>
          <span className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <span className="absolute left-0 top-full mt-1 z-30 w-56 rounded-lg border border-border bg-popover p-2 text-[11px] font-normal normal-case leading-snug text-popover-foreground shadow-lg">
            {text}
          </span>
        </>
      )}
    </span>
  );
}
