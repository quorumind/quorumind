/**
 * The Quorumind mark: a Q of four arcs, two voices answering each other, and the verdict dot.
 * The arcs draw in on load; `busy` makes the two voices turn around the verdict while models work.
 */
export function Mark({ busy = false }: { busy?: boolean }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className="mark" data-busy={busy}>
      <g className="mark-voice mark-thesis">
        <path
          d="M15.23 42.89A20 20 0 0 1 15.23 21.11M21.11 15.23A20 20 0 0 1 42.89 15.23"
          fill="none"
          stroke="var(--thesis)"
          strokeWidth="7"
          pathLength="100"
        />
      </g>
      <g className="mark-voice mark-antithesis">
        <path
          d="M48.77 21.11A20 20 0 0 1 48.77 42.89M42.89 48.77A20 20 0 0 1 21.11 48.77"
          fill="none"
          stroke="var(--antithesis)"
          strokeWidth="7"
          pathLength="100"
        />
      </g>
      <circle className="mark-dot" cx="53.57" cy="53.57" r="6.2" fill="var(--synthesis)" />
    </svg>
  );
}

/** A loading state that says what is loading, with the mark at work. */
export function Loader({ label }: { label: string }) {
  return (
    <div className="loader" role="status">
      <Mark busy />
      <span>{label}</span>
    </div>
  );
}

/** Placeholder blocks shaped like the content on its way. */
export function Skeleton({ lines = 3, card = false }: { lines?: number; card?: boolean }) {
  return (
    <div className={card ? "skeleton card" : "skeleton"} aria-hidden="true">
      {Array.from({ length: lines }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders.
        <span key={index} className="skeleton-line" style={{ inlineSize: `${index === lines - 1 ? 60 : 100 - index * 7}%` }} />
      ))}
    </div>
  );
}
