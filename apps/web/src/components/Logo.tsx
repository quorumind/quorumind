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

/** Two camps in a hemicycle, the brand's illustration of a debate. */
export function Hemicycle() {
  const rows = [
    { radius: 48, seats: 7 },
    { radius: 76, seats: 10 },
    { radius: 104, seats: 14 },
    { radius: 132, seats: 18 },
  ];
  const seats: { x: number; y: number; side: "thesis" | "antithesis" }[] = [];
  for (const row of rows) {
    for (let i = 0; i < row.seats; i++) {
      const angle = (Math.PI * i) / (row.seats - 1);
      if (Math.abs(angle - Math.PI / 2) < 1e-6) continue;
      seats.push({
        x: 160 + row.radius * Math.cos(angle),
        y: 160 - row.radius * Math.sin(angle),
        side: angle < Math.PI / 2 ? "antithesis" : "thesis",
      });
    }
  }
  return (
    <svg className="hemicycle" viewBox="0 0 320 200" aria-hidden="true">
      {seats.map((seat) => (
        <circle
          key={`${seat.x.toFixed(1)}-${seat.y.toFixed(1)}`}
          cx={seat.x}
          cy={seat.y}
          r="6"
          fill={seat.side === "thesis" ? "var(--thesis)" : "var(--antithesis)"}
        />
      ))}
      <circle cx="160" cy="176" r="10" fill="var(--synthesis)" />
    </svg>
  );
}
