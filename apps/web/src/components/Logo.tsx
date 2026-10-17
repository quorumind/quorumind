/** The Quorumind mark: a Q of four arcs, two voices answering each other, and the verdict dot. */
export function Mark() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <path
        d="M15.23 42.89A20 20 0 0 1 15.23 21.11M21.11 15.23A20 20 0 0 1 42.89 15.23"
        fill="none"
        stroke="var(--thesis)"
        strokeWidth="7"
      />
      <path
        d="M48.77 21.11A20 20 0 0 1 48.77 42.89M42.89 48.77A20 20 0 0 1 21.11 48.77"
        fill="none"
        stroke="var(--antithesis)"
        strokeWidth="7"
      />
      <circle cx="53.57" cy="53.57" r="6.2" fill="var(--synthesis)" />
    </svg>
  );
}
