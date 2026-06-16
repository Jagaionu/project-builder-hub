import { useEffect } from "react";

// Pulse a UI element so the user can see which control to press. The element is
// found by its data-ai-target attribute. Retries briefly so it works right
// after a route navigation (target may not be mounted yet).
export function highlightTarget(target: string | null | undefined) {
  if (!target || typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("ai:highlight", { detail: { target } }));
}

function findAndPulse(target: string, attempt = 0) {
  const el = document.querySelector<HTMLElement>(`[data-ai-target="${target}"]`);
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("ai-highlight");
    window.setTimeout(() => el.classList.remove("ai-highlight"), 4200);
    return;
  }
  if (attempt < 15) window.setTimeout(() => findAndPulse(target, attempt + 1), 200);
}

// Mounted once (in the app layout). Listens for ai:highlight events and pulses
// the matching element.
export function AiHighlightListener() {
  useEffect(() => {
    const onHighlight = (e: Event) => {
      const target = (e as CustomEvent<{ target?: string }>).detail?.target;
      if (target) findAndPulse(target);
    };
    window.addEventListener("ai:highlight", onHighlight);
    return () => window.removeEventListener("ai:highlight", onHighlight);
  }, []);
  return null;
}
