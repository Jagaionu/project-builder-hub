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

const FONT_STACK =
  "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/**
 * Renders a Mermaid diagram from a definition string (the body of a
 * ```mermaid fenced block). Styled to match the app (rounded nodes, soft
 * shadows, the user's AI accent colour) so it looks modern rather than the
 * default boxy mermaid look. Definitions come from the LLM, so we render with
 * securityLevel "strict" and fall back to the raw text on any parse error.
 */
export function MermaidDiagram({ chart, accent = "#3b82f6" }: { chart: string; accent?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mermaid = await loadMermaid();
        const dark = document.documentElement.classList.contains("dark");
        const nodeFill = dark ? "#1e293b" : "#ffffff";
        const nodeText = dark ? "#e2e8f0" : "#0f172a";
        const clusterFill = dark ? "#0f172a" : "#f8fafc";

        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "base",
          fontFamily: FONT_STACK,
          themeVariables: {
            fontFamily: FONT_STACK,
            fontSize: "14px",
            primaryColor: nodeFill,
            primaryTextColor: nodeText,
            primaryBorderColor: accent,
            lineColor: accent,
            secondaryColor: clusterFill,
            tertiaryColor: clusterFill,
            clusterBkg: clusterFill,
            clusterBorder: accent,
            edgeLabelBackground: "transparent",
          },
          flowchart: {
            useMaxWidth: true,
            htmlLabels: false,
            curve: "basis",
            nodeSpacing: 46,
            rankSpacing: 56,
            padding: 14,
          },
          themeCSS: `
            .node rect, .node polygon, .node circle, .node ellipse, .node path {
              rx: 12px; ry: 12px;
              stroke-width: 1.6px;
              filter: drop-shadow(0 2px 5px rgba(0,0,0,0.16));
            }
            .cluster rect { rx: 14px; ry: 14px; }
            .edgePath .path { stroke-width: 1.7px; }
            .marker { fill: ${accent}; stroke: ${accent}; }
            .node .label, .nodeLabel { font-weight: 600; }
            .edgeLabel, .edgeLabel p { font-weight: 500; }
          `,
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
  }, [chart, accent]);

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
      className="ai-mermaid my-2 flex justify-center overflow-auto rounded-xl border border-border/60 bg-background/60 p-3 [&_svg]:max-w-full [&_svg]:h-auto"
    />
  );
}
