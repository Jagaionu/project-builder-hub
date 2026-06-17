import { useEffect, useRef, useState } from "react";

// Lazy-load mermaid once, the first time a diagram is actually shown, so it
// stays out of the initial bundle.
let mermaidPromise: Promise<typeof import("mermaid").default> | null = null;
function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((m) => m.default);
  }
  return mermaidPromise;
}

let idCounter = 0;

/**
 * Renders a Mermaid diagram from a definition string (the body of a
 * ```mermaid fenced block). The definition comes from the LLM, so we render
 * with securityLevel "strict" and fall back to showing the raw text on any
 * parse error — nothing is ever lost.
 */
export function MermaidDiagram({ chart }: { chart: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mermaid = await loadMermaid();
        const dark = document.documentElement.classList.contains("dark");
        mermaid.initialize({
          startOnLoad: false,
          theme: dark ? "dark" : "default",
          securityLevel: "strict",
          flowchart: { useMaxWidth: true, htmlLabels: false },
        });
        const id = `ai-mermaid-${++idCounter}`;
        const { svg } = await mermaid.render(id, chart.trim());
        if (!cancelled && ref.current) {
          ref.current.innerHTML = svg;
          setError(false);
        }
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chart]);

  if (error) {
    return (
      <pre className="my-2 overflow-auto rounded-md border border-border/60 bg-background/80 p-2 text-[11px] text-foreground/80">
        {chart}
      </pre>
    );
  }

  return (
    <div
      ref={ref}
      className="ai-mermaid my-2 flex justify-center overflow-auto rounded-md border border-border/60 bg-background/60 p-2 [&_svg]:max-w-full [&_svg]:h-auto"
    />
  );
}
