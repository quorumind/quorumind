import { describe, expect, it } from "vitest";
import { DEMO_SCRIPT } from "./demo.ts";
import { type DiagramLayout, diagramSvg, layoutDiagram, wrapText } from "./diagram.ts";

type Box = { x: number; y: number; width: number; height: number };
const overlap = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

function expectNoOverlap(layout: DiagramLayout) {
  for (const [i, a] of layout.nodes.entries()) {
    for (const b of layout.nodes.slice(i + 1)) expect(overlap(a, b), `${a.id} overlaps ${b.id}`).toBe(false);
  }
}

function expectInside(layout: DiagramLayout) {
  for (const node of layout.nodes) {
    expect(node.x).toBeGreaterThanOrEqual(0);
    expect(node.y).toBeGreaterThanOrEqual(0);
    expect(node.x + node.width).toBeLessThanOrEqual(layout.width);
    expect(node.y + node.height).toBeLessThanOrEqual(layout.height);
  }
}

/** The edge starts on the border of its source box and ends on the border of its target box. */
function expectAttached(layout: DiagramLayout) {
  const byId = new Map(layout.nodes.map((node) => [node.id, node]));
  const onBorder = (point: { x: number; y: number }, box: Box) =>
    point.x >= box.x - 0.5 && point.x <= box.x + box.width + 0.5 && point.y >= box.y - 0.5 && point.y <= box.y + box.height + 0.5;
  for (const edge of layout.edges) {
    expect(edge.points.length).toBeGreaterThanOrEqual(2);
    expect(onBorder(edge.points[0]!, byId.get(edge.from)!), `${edge.from} → ${edge.to} start`).toBe(true);
    expect(onBorder(edge.points.at(-1)!, byId.get(edge.to)!), `${edge.from} → ${edge.to} end`).toBe(true);
  }
}

describe("architecture diagram layout", () => {
  const { components, flows } = DEMO_SCRIPT.proposals.A!;

  it("lays out the demo architecture without overlapping boxes", () => {
    const layout = layoutDiagram(components, flows);
    expect(layout.nodes).toHaveLength(components.length);
    expectNoOverlap(layout);
    expectInside(layout);
  });

  it("draws every flow, including both directions between two components", () => {
    const layout = layoutDiagram(components, flows);
    expect(layout.edges).toHaveLength(flows.length);
    expectAttached(layout);
    const there = layout.edges.find((edge) => edge.from === "app" && edge.to === "stripe")!;
    const back = layout.edges.find((edge) => edge.from === "stripe" && edge.to === "app")!;
    expect(there.points[0]).not.toEqual(back.points.at(-1));
    expect(overlap(there.labelBox!, back.labelBox!)).toBe(false);
  });

  it("places sources before their targets, left to right", () => {
    const layout = layoutDiagram(components, flows);
    const x = (id: string) => layout.nodes.find((node) => node.id === id)!.x;
    expect(x("members")).toBeLessThan(x("app"));
    expect(x("app")).toBeLessThan(x("db"));
  });

  it("handles cycles, self-loops and flows to unknown components", () => {
    const layout = layoutDiagram(
      [
        { id: "a", label: "A", kind: "service" },
        { id: "b", label: "B", kind: "queue" },
        { id: "c", label: "C", kind: "database" },
      ],
      [
        { from: "a", to: "b", label: "1" },
        { from: "b", to: "c", label: "2" },
        { from: "c", to: "a", label: "3" },
        { from: "a", to: "a", label: "retry" },
        { from: "c", to: "ghost", label: "" },
      ],
    );
    expect(layout.nodes.map((node) => node.id).sort()).toEqual(["a", "b", "c", "ghost"]);
    expect(layout.edges).toHaveLength(5);
    expect(layout.edges.find((edge) => edge.from === "a" && edge.to === "a")?.loop).toBe(true);
    expect(layout.edges.find((edge) => edge.to === "ghost")?.labelBox).toBeNull();
    expectNoOverlap(layout);
    expectAttached(layout);
    expectInside(layout);
  });

  it("routes long edges around the boxes of the layers they cross", () => {
    const layout = layoutDiagram(
      ["a", "b", "c", "d"].map((id) => ({ id, label: id.toUpperCase(), kind: "service" })),
      [
        { from: "a", to: "b", label: "" },
        { from: "b", to: "c", label: "" },
        { from: "c", to: "d", label: "" },
        { from: "a", to: "d", label: "shortcut" },
      ],
    );
    const shortcut = layout.edges.find((edge) => edge.label === "shortcut")!;
    expect(shortcut.points).toHaveLength(4);
    for (const point of shortcut.points.slice(1, -1)) {
      for (const node of layout.nodes) expect(overlap({ ...point, width: 0, height: 0 }, node), node.id).toBe(false);
    }
  });

  it("mirrors the drawing for right-to-left documents", () => {
    const ltr = layoutDiagram(components, flows);
    const rtl = layoutDiagram(components, flows, { rtl: true });
    const members = (layout: DiagramLayout) => layout.nodes.find((node) => node.id === "members")!;
    expect(members(rtl).x).toBeCloseTo(ltr.width - members(ltr).x - members(ltr).width, 0);
    expectAttached(rtl);
  });

  it("wraps long labels, including scripts without spaces", () => {
    expect(wrapText("A very long component label that cannot fit on a single line", 150, 13).length).toBeGreaterThan(1);
    const japanese = wrapText("会員向けのウェブおよびモバイルアプリケーション", 150, 13);
    expect(japanese.length).toBeGreaterThan(1);
    expect(japanese.length).toBeLessThanOrEqual(3);
  });

  it("returns an empty layout for a proposal without components", () => {
    expect(layoutDiagram([], []).nodes).toEqual([]);
  });

  it("escapes every label in the SVG", () => {
    const layout = layoutDiagram(
      [{ id: "x", label: '<script>alert("x")</script>', kind: "client" }],
      [{ from: "x", to: "y", label: "a & b" }],
    );
    const svg = diagramSvg(layout, undefined, { title: "</title><script>" });
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
    expect(svg).toContain("a &amp; b");
  });
});
