import type { ComponentKind } from "./schemas.ts";

// Architecture diagrams drawn from a proposal's components and flows. Browser-safe and without
// dependencies: the web interface renders the layout as React SVG, the HTML export as a string.
//
// The layout is a classic layered (Sugiyama-style) drawing, left to right:
//   1. cycles are broken by a depth-first search that reverses back edges,
//   2. each component goes to the layer of its longest path from a source,
//   3. edges spanning several layers get invisible waypoints, so they route around boxes,
//   4. barycenter sweeps order each layer to reduce crossings,
//   5. boxes are pulled toward the average height of their neighbours without overlapping.

export interface DiagramComponent {
  id: string;
  label: string;
  kind: ComponentKind | string;
}

export interface DiagramFlow {
  from: string;
  to: string;
  label: string;
}

export interface Point {
  x: number;
  y: number;
}

export interface DiagramNode {
  id: string;
  label: string;
  kind: ComponentKind;
  x: number;
  y: number;
  width: number;
  height: number;
  /** The label wrapped to fit the box. */
  lines: string[];
}

export interface DiagramLabel {
  x: number;
  y: number;
  width: number;
  height: number;
  lines: string[];
}

export interface DiagramEdge {
  from: string;
  to: string;
  label: string;
  /** From the border of the source box to the border of the target box. */
  points: Point[];
  /** Where the label is drawn, null when the flow has no label. */
  labelBox: DiagramLabel | null;
  /** A flow back to its own source box, drawn as a loop. */
  loop: boolean;
}

export interface DiagramLayout {
  width: number;
  height: number;
  rtl: boolean;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}

export interface LayoutOptions {
  /** Flows run right to left, for Arabic documents. */
  rtl?: boolean;
}

export const COMPONENT_KINDS: readonly ComponentKind[] = ["client", "service", "database", "storage", "queue", "external", "infra"];

const NODE_FONT = 13;
const NODE_LINE = 17;
const EDGE_FONT = 11;
const EDGE_LINE = 14;
const NODE_TEXT_MAX = 150;
const EDGE_TEXT_MAX = 128;
const ICON = 16;
const ICON_GAP = 8;
const PAD_X = 12;
const PAD_Y = 12;
const CYLINDER_RY = 7;
const NODE_GAP = 28;
const WAYPOINT_SIZE = 12;
const LAYER_GAP_MIN = 72;
const MARGIN = 16;
const LOOP_SIZE = 22;

/** Approximate advance of a character, in ems: enough to size boxes without a font engine. */
function charWidth(char: string): number {
  const code = char.codePointAt(0) ?? 0;
  if (char === " ") return 0.3;
  // CJK, kana, hangul and full-width forms take a full em.
  if ((code >= 0x1100 && code <= 0x115f) || (code >= 0x2e80 && code <= 0xa4cf) || (code >= 0xac00 && code <= 0xd7a3)) return 1;
  if ((code >= 0xf900 && code <= 0xfaff) || (code >= 0xfe30 && code <= 0xfe4f) || (code >= 0xff00 && code <= 0xff60)) return 1;
  if (/[A-Z0-9]/.test(char)) return 0.64;
  if (/[iljtf.,;:'|!()[\]]/.test(char)) return 0.32;
  if (/[mwMW@]/.test(char)) return 0.86;
  return 0.56;
}

export function textWidth(text: string, size: number): number {
  let width = 0;
  for (const char of text) width += charWidth(char);
  return width * size;
}

const isWide = (char: string) => charWidth(char) === 1;

/** Wraps on spaces, or between characters for scripts written without them; at most `maxLines`. */
export function wrapText(text: string, maxWidth: number, size: number, maxLines = 3): string[] {
  const words = text.trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
  // Characters of CJK runs can break anywhere: split them into single-character tokens.
  const tokens = words.flatMap((word, index) => {
    const pieces = [...word].some(isWide) ? [...word] : [word];
    return pieces.map((piece, i) => ({ text: piece, space: index > 0 && i === 0 }));
  });
  const lines: string[] = [];
  let line = "";
  for (const token of tokens) {
    const candidate = line ? `${line}${token.space ? " " : ""}${token.text}` : token.text;
    if (textWidth(candidate, size) <= maxWidth || !line) {
      line = candidate;
      continue;
    }
    lines.push(line);
    line = token.text;
  }
  if (line) lines.push(line);
  const split = lines.flatMap((item) => (textWidth(item, size) > maxWidth ? hardBreak(item, maxWidth, size) : [item]));
  if (split.length <= maxLines) return split.length > 0 ? split : [""];
  const kept = split.slice(0, maxLines);
  let last = `${kept[maxLines - 1]}…`;
  while (textWidth(last, size) > maxWidth && last.length > 1) last = `${[...last].slice(0, -2).join("")}…`;
  kept[maxLines - 1] = last;
  return kept;
}

function hardBreak(text: string, maxWidth: number, size: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const char of text) {
    if (line && textWidth(line + char, size) > maxWidth) {
      out.push(line);
      line = "";
    }
    line += char;
  }
  if (line) out.push(line);
  return out;
}

const knownKind = (kind: string): ComponentKind =>
  (COMPONENT_KINDS as readonly string[]).includes(kind) ? (kind as ComponentKind) : "service";

interface Vertex {
  id: string;
  /** Waypoints of long edges have no box. */
  virtual: boolean;
  layer: number;
  width: number;
  height: number;
  x: number;
  y: number;
}

interface Segment {
  edge: number;
  from: string;
  to: string;
}

export function layoutDiagram(components: DiagramComponent[], flows: DiagramFlow[], options: LayoutOptions = {}): DiagramLayout {
  // 1. Boxes, deduplicated; a flow naming an unknown component still gets a box, so every flow is drawn.
  const nodes = new Map<string, DiagramNode>();
  const addNode = (id: string, label: string, kind: string) => {
    if (nodes.has(id)) return;
    const lines = wrapText(label || id, NODE_TEXT_MAX, NODE_FONT);
    const textW = Math.max(...lines.map((line) => textWidth(line, NODE_FONT)));
    const resolved = knownKind(kind);
    const padX = PAD_X + (resolved === "queue" ? 6 : 0);
    const width = Math.max(112, Math.ceil(padX * 2 + ICON + ICON_GAP + textW));
    const height = Math.max(44, lines.length * NODE_LINE + PAD_Y * 2) + (resolved === "database" ? CYLINDER_RY * 2 : 0);
    nodes.set(id, { id, label: label || id, kind: resolved, x: 0, y: 0, width, height, lines });
  };
  for (const component of components) addNode(component.id, component.label, component.kind);
  for (const flow of flows) {
    addNode(flow.from, flow.from, "service");
    addNode(flow.to, flow.to, "service");
  }
  const ids = [...nodes.keys()];

  // 2. Break cycles: a depth-first search from the sources reverses every edge that points back up the stack.
  const reversed = flows.map(() => false);
  const outgoing = new Map<string, number[]>(ids.map((id) => [id, []]));
  flows.forEach((flow, index) => {
    if (flow.from !== flow.to) outgoing.get(flow.from)?.push(index);
  });
  const hasIncoming = new Set(flows.filter((flow) => flow.from !== flow.to).map((flow) => flow.to));
  const state = new Map<string, "active" | "done">();
  const visit = (id: string) => {
    state.set(id, "active");
    for (const index of outgoing.get(id) ?? []) {
      const target = (flows[index] as DiagramFlow).to;
      const seen = state.get(target);
      if (seen === "active") reversed[index] = true;
      else if (!seen) visit(target);
    }
    state.set(id, "done");
  };
  for (const id of [...ids.filter((id) => !hasIncoming.has(id)), ...ids]) if (!state.has(id)) visit(id);

  // The acyclic graph used for layering: each edge points from a lower to a higher layer.
  const dag = flows
    .map((flow, index) => ({ index, from: reversed[index] ? flow.to : flow.from, to: reversed[index] ? flow.from : flow.to }))
    .filter((edge) => edge.from !== edge.to);

  // 3. Longest-path layering from the sources (Kahn's order).
  const layer = new Map<string, number>(ids.map((id) => [id, 0]));
  const indegree = new Map<string, number>(ids.map((id) => [id, 0]));
  for (const edge of dag) indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
  const queue = ids.filter((id) => indegree.get(id) === 0);
  while (queue.length > 0) {
    const id = queue.shift() as string;
    for (const edge of dag) {
      if (edge.from !== id) continue;
      layer.set(edge.to, Math.max(layer.get(edge.to) ?? 0, (layer.get(id) ?? 0) + 1));
      const left = (indegree.get(edge.to) ?? 0) - 1;
      indegree.set(edge.to, left);
      if (left === 0) queue.push(edge.to);
    }
  }

  // 4. Long edges get one waypoint per layer they cross.
  const vertices = new Map<string, Vertex>();
  for (const id of ids) {
    const node = nodes.get(id) as DiagramNode;
    vertices.set(id, { id, virtual: false, layer: layer.get(id) ?? 0, width: node.width, height: node.height, x: 0, y: 0 });
  }
  const segments: Segment[] = [];
  const chains = new Map<number, string[]>();
  for (const edge of dag) {
    const chain = [edge.from];
    for (let l = (layer.get(edge.from) ?? 0) + 1; l < (layer.get(edge.to) ?? 0); l++) {
      const id = `\u0000${edge.index}:${l}`;
      vertices.set(id, { id, virtual: true, layer: l, width: 0, height: WAYPOINT_SIZE, x: 0, y: 0 });
      chain.push(id);
    }
    chain.push(edge.to);
    chains.set(edge.index, chain);
    for (let i = 0; i < chain.length - 1; i++) segments.push({ edge: edge.index, from: chain[i] as string, to: chain[i + 1] as string });
  }

  // 5. Order each layer with barycenter sweeps, keeping the order with the fewest crossings.
  const layerCount = Math.max(0, ...[...vertices.values()].map((vertex) => vertex.layer)) + 1;
  let order: string[][] = Array.from({ length: layerCount }, () => []);
  for (const vertex of vertices.values()) order[vertex.layer]?.push(vertex.id);
  const predecessors = new Map<string, string[]>();
  const successors = new Map<string, string[]>();
  for (const segment of segments) {
    predecessors.set(segment.to, [...(predecessors.get(segment.to) ?? []), segment.from]);
    successors.set(segment.from, [...(successors.get(segment.from) ?? []), segment.to]);
  }
  const positionsOf = (layers: string[][]) => new Map(layers.flatMap((ids) => ids.map((id, index) => [id, index] as const)));
  const crossings = (layers: string[][]) => {
    const position = positionsOf(layers);
    let count = 0;
    for (let l = 0; l < layers.length - 1; l++) {
      const between = segments.filter((segment) => vertices.get(segment.from)?.layer === l);
      for (let i = 0; i < between.length; i++) {
        for (let j = i + 1; j < between.length; j++) {
          const a = between[i] as Segment;
          const b = between[j] as Segment;
          const top = (position.get(a.from) ?? 0) - (position.get(b.from) ?? 0);
          const bottom = (position.get(a.to) ?? 0) - (position.get(b.to) ?? 0);
          if (top * bottom < 0) count++;
        }
      }
    }
    return count;
  };
  let best = order.map((ids) => [...ids]);
  let bestCrossings = crossings(best);
  for (let pass = 0; pass < 8 && bestCrossings > 0; pass++) {
    const down = pass % 2 === 0;
    const next = order.map((ids) => [...ids]);
    const range = down ? [...Array(layerCount).keys()].slice(1) : [...Array(layerCount).keys()].slice(0, -1).reverse();
    for (const l of range) {
      const position = positionsOf(next);
      const neighbours = down ? predecessors : successors;
      const current = next[l] as string[];
      const weight = new Map(
        current.map((id, index) => {
          const linked = neighbours.get(id) ?? [];
          if (linked.length === 0) return [id, index] as const;
          return [id, linked.reduce((sum, other) => sum + (position.get(other) ?? 0), 0) / linked.length] as const;
        }),
      );
      next[l] = current
        .map((id, index) => ({ id, index }))
        .sort((a, b) => (weight.get(a.id) ?? 0) - (weight.get(b.id) ?? 0) || a.index - b.index)
        .map((item) => item.id);
    }
    order = next;
    const count = crossings(order);
    if (count < bestCrossings) {
      best = order.map((ids) => [...ids]);
      bestCrossings = count;
    }
  }
  order = best;

  // 6. Horizontal placement: one column per layer, as wide as its widest box, with room for edge labels.
  const labelLayout = new Map<number, string[]>();
  const labelGap = Array.from({ length: layerCount }, () => 0);
  flows.forEach((flow, index) => {
    if (!flow.label.trim()) return;
    const lines = wrapText(flow.label, EDGE_TEXT_MAX, EDGE_FONT, 2);
    labelLayout.set(index, lines);
    const chain = chains.get(index);
    if (!chain) return;
    const l = vertices.get(chain[0] as string)?.layer ?? 0;
    const width = Math.max(...lines.map((line) => textWidth(line, EDGE_FONT))) + 10;
    labelGap[l] = Math.max(labelGap[l] ?? 0, width);
  });
  const columnWidth = order.map((ids) => Math.max(0, ...ids.map((id) => vertices.get(id)?.width ?? 0)));
  let cursor = 0;
  const columnX: number[] = [];
  for (let l = 0; l < layerCount; l++) {
    columnX.push(cursor);
    cursor += (columnWidth[l] ?? 0) + Math.max(LAYER_GAP_MIN, (labelGap[l] ?? 0) + 36);
  }
  for (const vertex of vertices.values()) {
    const left = columnX[vertex.layer] ?? 0;
    const width = columnWidth[vertex.layer] ?? 0;
    vertex.x = vertex.virtual ? left + width / 2 : left + (width - vertex.width) / 2;
  }

  // 7. Vertical placement: stack each layer, then pull boxes toward their neighbours, keeping the order and the gaps.
  const gapAfter = (a: Vertex, b: Vertex) => (a.virtual || b.virtual ? NODE_GAP / 2 : NODE_GAP);
  for (const ids of order) {
    let top = 0;
    let previous: Vertex | null = null;
    for (const id of ids) {
      const vertex = vertices.get(id) as Vertex;
      if (previous) top += gapAfter(previous, vertex);
      vertex.y = top;
      top += vertex.height;
      previous = vertex;
    }
  }
  const center = (vertex: Vertex) => vertex.y + vertex.height / 2;
  const place = (ids: string[], desired: Map<string, number>) => {
    const column = ids.map((id) => vertices.get(id) as Vertex);
    const tops = column.map((vertex) => (desired.get(vertex.id) ?? center(vertex)) - vertex.height / 2);
    for (let i = 1; i < column.length; i++) {
      const prev = column[i - 1] as Vertex;
      tops[i] = Math.max(tops[i] as number, (tops[i - 1] as number) + prev.height + gapAfter(prev, column[i] as Vertex));
    }
    for (let i = column.length - 2; i >= 0; i--) {
      const vertex = column[i] as Vertex;
      tops[i] = Math.min(tops[i] as number, (tops[i + 1] as number) - vertex.height - gapAfter(vertex, column[i + 1] as Vertex));
    }
    column.forEach((vertex, i) => {
      vertex.y = tops[i] as number;
    });
  };
  for (let pass = 0; pass < 6; pass++) {
    const down = pass % 2 === 0;
    const range = down ? [...Array(layerCount).keys()].slice(1) : [...Array(layerCount).keys()].slice(0, -1).reverse();
    for (const l of range) {
      const neighbours = down ? predecessors : successors;
      const desired = new Map<string, number>();
      for (const id of order[l] as string[]) {
        const linked = (neighbours.get(id) ?? []).map((other) => vertices.get(other) as Vertex);
        if (linked.length > 0) desired.set(id, linked.reduce((sum, other) => sum + center(other), 0) / linked.length);
      }
      place(order[l] as string[], desired);
    }
  }
  for (const node of nodes.values()) {
    const vertex = vertices.get(node.id) as Vertex;
    node.x = vertex.x;
    node.y = vertex.y;
  }

  // 8. Edges: ports spread along the sides of each box, ordered by where the other end is.
  const ports = new Map<string, Point>();
  const side = (id: string, segmentsOnSide: Segment[], end: "from" | "to") => {
    const vertex = vertices.get(id) as Vertex;
    const other = (segment: Segment) => vertices.get(end === "from" ? segment.to : segment.from) as Vertex;
    const sorted = [...segmentsOnSide].sort((a, b) => center(other(a)) - center(other(b)));
    const usable = vertex.virtual ? 0 : Math.max(0, vertex.height - (nodes.get(id)?.kind === "database" ? 4 * CYLINDER_RY : 16));
    const step = sorted.length > 1 ? Math.min(14, usable / (sorted.length - 1)) : 0;
    sorted.forEach((segment, index) => {
      const offset = (index - (sorted.length - 1) / 2) * step;
      const x = vertex.virtual ? vertex.x : end === "from" ? vertex.x + vertex.width : vertex.x;
      ports.set(`${segment.edge}:${segment.from}>${segment.to}:${end}`, { x, y: center(vertex) + offset });
    });
  };
  for (const id of vertices.keys()) {
    side(
      id,
      segments.filter((segment) => segment.from === id),
      "from",
    );
    side(
      id,
      segments.filter((segment) => segment.to === id),
      "to",
    );
  }

  const placedLabels: DiagramLabel[] = [];
  const boxes = [...nodes.values()];
  const overlaps = (a: { x: number; y: number; width: number; height: number }, b: typeof a, pad = 2) =>
    a.x < b.x + b.width + pad && b.x < a.x + a.width + pad && a.y < b.y + b.height + pad && b.y < a.y + a.height + pad;
  // A label sits on the middle of its first segment; when that spot is taken, the nearest free spot
  // along the segment or just above or below it.
  const placeLabel = (lines: string[], from: Point, to: Point): DiagramLabel => {
    const width = Math.ceil(Math.max(...lines.map((line) => textWidth(line, EDGE_FONT))) + 10);
    const height = lines.length * EDGE_LINE + 6;
    const candidates: { at: Point; cost: number }[] = [];
    for (const t of [0.5, 0.35, 0.65]) {
      for (let shift = -72; shift <= 72; shift += 6) {
        const at = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t + shift };
        candidates.push({ at, cost: Math.abs(shift) + Math.abs(t - 0.5) * 40 });
      }
    }
    candidates.sort((a, b) => a.cost - b.cost);
    const box = (at: Point): DiagramLabel => ({ x: at.x - width / 2, y: at.y - height / 2, width, height, lines });
    const free = candidates
      .map((candidate) => box(candidate.at))
      .find((candidate) => !boxes.some((node) => overlaps(candidate, node)) && !placedLabels.some((label) => overlaps(candidate, label)));
    const chosen = free ?? box({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 });
    placedLabels.push(chosen);
    return chosen;
  };

  const edges: DiagramEdge[] = flows.map((flow, index) => {
    const lines = labelLayout.get(index) ?? null;
    if (flow.from === flow.to) {
      const node = nodes.get(flow.from) as DiagramNode;
      const startX = node.x + node.width - 28;
      const sideY = node.y + Math.min(18, node.height / 3);
      const points = [
        { x: startX, y: node.y },
        { x: startX, y: node.y - LOOP_SIZE },
        { x: node.x + node.width + LOOP_SIZE, y: node.y - LOOP_SIZE },
        { x: node.x + node.width + LOOP_SIZE, y: sideY },
        { x: node.x + node.width, y: sideY },
      ];
      const above = { x: node.x + node.width, y: node.y - LOOP_SIZE - 12 };
      const labelBox = lines ? placeLabel(lines, above, above) : null;
      return { from: flow.from, to: flow.to, label: flow.label, points, labelBox, loop: true };
    }
    const chain = chains.get(index) as string[];
    const points: Point[] = [];
    for (let i = 0; i < chain.length - 1; i++) {
      const key = `${index}:${chain[i]}>${chain[i + 1]}`;
      if (i === 0) points.push(ports.get(`${key}:from`) as Point);
      points.push(ports.get(`${key}:to`) as Point);
    }
    const first = points[0] as Point;
    const second = points[1] as Point;
    const labelBox = lines ? placeLabel(lines, first, second) : null;
    if (reversed[index]) points.reverse();
    return { from: flow.from, to: flow.to, label: flow.label, points, labelBox, loop: false };
  });

  // 9. Normalise to a margin around everything that is drawn, then mirror for right-to-left documents.
  const xs: number[] = [];
  const ys: number[] = [];
  const extend = (box: { x: number; y: number; width: number; height: number }) => {
    xs.push(box.x, box.x + box.width);
    ys.push(box.y, box.y + box.height);
  };
  for (const node of nodes.values()) extend(node);
  for (const edge of edges) {
    for (const point of edge.points) extend({ ...point, width: 0, height: 0 });
    if (edge.labelBox) extend(edge.labelBox);
  }
  if (xs.length === 0) return { width: 0, height: 0, rtl: Boolean(options.rtl), nodes: [], edges: [] };
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const width = Math.ceil(Math.max(...xs) - minX + 2 * MARGIN);
  const height = Math.ceil(Math.max(...ys) - minY + 2 * MARGIN);
  const rtl = Boolean(options.rtl);
  const mapX = (x: number, w = 0) => {
    const shifted = x - minX + MARGIN;
    return round(rtl ? width - shifted - w : shifted);
  };
  const mapY = (y: number) => round(y - minY + MARGIN);
  return {
    width,
    height,
    rtl,
    nodes: [...nodes.values()].map((node) => ({ ...node, x: mapX(node.x, node.width), y: mapY(node.y) })),
    edges: edges.map((edge) => ({
      ...edge,
      points: edge.points.map((point) => ({ x: mapX(point.x), y: mapY(point.y) })),
      labelBox: edge.labelBox ? { ...edge.labelBox, x: mapX(edge.labelBox.x, edge.labelBox.width), y: mapY(edge.labelBox.y) } : null,
    })),
  };
}

const round = (value: number) => Math.round(value * 10) / 10;

// Drawing helpers shared by the SVG string below and the React component.

/** A smooth path through the points: horizontal S-curves between waypoints, straight corners for loops. */
export function edgePath(edge: DiagramEdge): string {
  const [first, ...rest] = edge.points;
  if (!first) return "";
  let d = `M${first.x} ${first.y}`;
  if (edge.loop) {
    for (const point of rest) d += ` L${point.x} ${point.y}`;
    return d;
  }
  let previous = first;
  for (const point of rest) {
    const mid = (previous.x + point.x) / 2;
    d += ` C${round(mid)} ${previous.y} ${round(mid)} ${point.y} ${point.x} ${point.y}`;
    previous = point;
  }
  return d;
}

function roundedRect(x: number, y: number, w: number, h: number, r: number): string {
  return `M${x + r} ${y} H${x + w - r} A${r} ${r} 0 0 1 ${x + w} ${y + r} V${y + h - r} A${r} ${r} 0 0 1 ${x + w - r} ${y + h} H${x + r} A${r} ${r} 0 0 1 ${x} ${y + h - r} V${y + r} A${r} ${r} 0 0 1 ${x + r} ${y} Z`;
}

/** The outline of a box, and the extra strokes that make its kind recognisable (a cylinder's rim, a queue's ends). */
export function nodeShape(node: DiagramNode): { body: string; detail: string | null } {
  const { x, y, width: w, height: h } = node;
  switch (node.kind) {
    case "database": {
      const rx = w / 2;
      const ry = CYLINDER_RY;
      return {
        body: `M${x} ${y + ry} A${rx} ${ry} 0 0 1 ${x + w} ${y + ry} V${y + h - ry} A${rx} ${ry} 0 0 1 ${x} ${y + h - ry} Z`,
        detail: `M${x} ${y + ry} A${rx} ${ry} 0 0 0 ${x + w} ${y + ry}`,
      };
    }
    case "client":
      return { body: roundedRect(x, y, w, h, Math.min(16, h / 2)), detail: null };
    case "queue":
      return { body: roundedRect(x, y, w, h, 6), detail: `M${x + 7} ${y + 8} V${y + h - 8} M${x + w - 7} ${y + 8} V${y + h - 8}` };
    case "storage":
      return { body: roundedRect(x, y, w, h, 3), detail: null };
    default:
      return { body: roundedRect(x, y, w, h, 8), detail: null };
  }
}

/** Icons on a 24-unit grid, drawn with a 1.5 stroke like the interface's icon set. */
export const KIND_ICONS: Record<ComponentKind, string> = {
  client: "M3.5 5h17v11h-17z M9 20h6 M12 16v4",
  service: "M8.5 7.5L4 12l4.5 4.5 M15.5 7.5L20 12l-4.5 4.5 M13.5 5.5l-3 13",
  database: "M5 6c0-1.7 3.1-3 7-3s7 1.3 7 3-3.1 3-7 3-7-1.3-7-3z M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6 M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3",
  storage: "M3.5 6.5h6l2 2h9v10.5h-17z",
  queue: "M3.5 8h4v8h-4z M10 8h4v8h-4z M16.5 8h4v8h-4z",
  external: "M14 4h6v6 M20 4l-9 9 M18 14v6H4V6h6",
  infra: "M7 18.5h10.5a4 4 0 0 0 .4-8 6 6 0 0 0-11.6 1.3A3.4 3.4 0 0 0 7 18.5z",
};

/** Direction of a text from its first strong character, like dir="auto". */
export function textDirection(text: string): "ltr" | "rtl" {
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if ((code >= 0x0590 && code <= 0x08ff) || (code >= 0xfb1d && code <= 0xfdff) || (code >= 0xfe70 && code <= 0xfeff)) return "rtl";
    if (/\p{L}/u.test(char)) return "ltr";
  }
  return "ltr";
}

/**
 * Where the icon and the text lines of a box go. Text lines align on the inline-start side of the
 * drawing (the right in a right-to-left layout) whatever their own direction, which each line
 * carries so mixed scripts and punctuation are ordered correctly.
 */
export function nodeContent(node: DiagramNode, rtl: boolean) {
  const padX = PAD_X + (node.kind === "queue" ? 6 : 0);
  const middle = node.y + node.height / 2 + (node.kind === "database" ? CYLINDER_RY / 2 : 0);
  const iconX = rtl ? node.x + node.width - padX - ICON : node.x + padX;
  const textX = rtl ? node.x + node.width - padX - ICON - ICON_GAP : node.x + padX + ICON + ICON_GAP;
  const firstBaseline = middle - ((node.lines.length - 1) * NODE_LINE) / 2 + NODE_FONT * 0.35;
  return {
    icon: { x: round(iconX), y: round(middle - ICON / 2), scale: ICON / 24 },
    lines: node.lines.map((text, i) => {
      const direction = textDirection(text);
      // text-anchor follows the text's own direction: "start" is the right end of a right-to-left line.
      const anchor: "start" | "end" = (direction === "rtl") === rtl ? "start" : "end";
      return { text, x: round(textX), y: round(firstBaseline + i * NODE_LINE), direction, anchor };
    }),
  };
}

/** Baselines of an edge label's lines, centered in its box. */
export function labelLines(label: DiagramLabel) {
  return label.lines.map((text, i) => ({
    text,
    x: round(label.x + label.width / 2),
    y: round(label.y + 3 + EDGE_LINE * i + EDGE_LINE * 0.72),
    direction: textDirection(text),
  }));
}

export const DIAGRAM_FONT_SIZES = { node: NODE_FONT, edge: EDGE_FONT } as const;

export interface DiagramTheme {
  fontFamily: string;
  ink: string;
  muted: string;
  edge: string;
  labelBackground: string;
  kinds: Record<ComponentKind, { stroke: string; fill: string }>;
}

/** The "Contrepoint" light palette, for documents. */
export const DIAGRAM_THEME: DiagramTheme = {
  fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif',
  ink: "#141a3a",
  muted: "#535a78",
  edge: "#7a809c",
  labelBackground: "#ffffff",
  kinds: {
    client: { stroke: "#2b44c4", fill: "#e4e8fa" },
    service: { stroke: "#141a3a", fill: "#ffffff" },
    database: { stroke: "#0f766e", fill: "#ddf2ef" },
    storage: { stroke: "#0f766e", fill: "#ffffff" },
    queue: { stroke: "#8a5a00", fill: "#fbf1dc" },
    external: { stroke: "#535a78", fill: "#f6f7fb" },
    infra: { stroke: "#7c45b0", fill: "#f1eaf8" },
  },
};

const xml = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

/** A standalone SVG of the layout, for the HTML export. Every text is escaped. */
export function diagramSvg(
  layout: DiagramLayout,
  theme: DiagramTheme = DIAGRAM_THEME,
  options: { title?: string; description?: string; idPrefix?: string } = {},
): string {
  const prefix = (options.idPrefix ?? "qd").replace(/[^A-Za-z0-9_-]/g, "");
  const title = options.title ? `<title id="${prefix}-title">${xml(options.title)}</title>` : "";
  const desc = options.description ? `<desc id="${prefix}-desc">${xml(options.description)}</desc>` : "";
  const labelled = [options.title ? `${prefix}-title` : "", options.description ? `${prefix}-desc` : ""].filter(Boolean).join(" ");
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${layout.width} ${layout.height}" width="${layout.width}" height="${layout.height}" role="img"${labelled ? ` aria-labelledby="${labelled}"` : ""} font-family="${xml(theme.fontFamily)}">`,
    title,
    desc,
    `<defs><marker id="${prefix}-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 1L9 5L0 9z" fill="${theme.edge}"/></marker></defs>`,
  ];
  for (const edge of layout.edges) {
    parts.push(
      `<path d="${edgePath(edge)}" fill="none" stroke="${theme.edge}" stroke-width="1.5" stroke-linejoin="round" marker-end="url(#${prefix}-arrow)"/>`,
    );
  }
  for (const edge of layout.edges) {
    if (!edge.labelBox) continue;
    const box = edge.labelBox;
    parts.push(
      `<rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="4" fill="${theme.labelBackground}" fill-opacity="0.94"/>`,
      ...labelLines(box).map(
        (line) =>
          `<text x="${line.x}" y="${line.y}" font-size="${EDGE_FONT}" text-anchor="middle" direction="${line.direction}" fill="${theme.muted}">${xml(line.text)}</text>`,
      ),
    );
  }
  for (const node of layout.nodes) {
    const colors = theme.kinds[node.kind];
    const shape = nodeShape(node);
    const content = nodeContent(node, layout.rtl);
    const dashed = node.kind === "external" ? ' stroke-dasharray="5 4"' : "";
    parts.push(
      `<g data-kind="${node.kind}">`,
      `<path d="${shape.body}" fill="${colors.fill}" stroke="${colors.stroke}" stroke-width="1.5"${dashed}/>`,
      shape.detail ? `<path d="${shape.detail}" fill="none" stroke="${colors.stroke}" stroke-width="1.5"/>` : "",
      `<path d="${KIND_ICONS[node.kind]}" transform="translate(${content.icon.x} ${content.icon.y}) scale(${content.icon.scale})" fill="none" stroke="${colors.stroke}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`,
      ...content.lines.map(
        (line) =>
          `<text x="${line.x}" y="${line.y}" font-size="${NODE_FONT}" font-weight="600" text-anchor="${line.anchor}" direction="${line.direction}" fill="${theme.ink}">${xml(line.text)}</text>`,
      ),
      "</g>",
    );
  }
  parts.push("</svg>");
  return parts.filter(Boolean).join("");
}
