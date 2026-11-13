import { type ReactNode, useState } from "react";
import { useScrollEdges } from "../SessionStatus.tsx";

/**
 * A table (or any wide content) that scrolls sideways inside its frame. When it does scroll, the frame can take the
 * keyboard focus and is a named region for screen readers; and shows a shadow on each edge that has more beyond it. The table's first column
 * stays in view while the rest scrolls (see `.table-wrap` in styles.css).
 */
export function ScrollRegion({ label, children }: { label: string; children: ReactNode }) {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const edges = useScrollEdges(node);
  // Only a table that really scrolls is a stop for the keyboard and a named region: one that fits is just a table.
  const scrolls = edges !== "";
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be reachable by keyboard (WCAG 2.1.1).
    <section
      ref={setNode}
      className="table-wrap"
      aria-label={scrolls ? label : undefined}
      tabIndex={scrolls ? 0 : undefined}
      data-edges={edges || undefined}
    >
      {children}
    </section>
  );
}
