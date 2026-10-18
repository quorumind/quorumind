import {
  type DiagramComponent,
  type DiagramFlow,
  edgePath,
  KIND_ICONS,
  labelLines,
  layoutDiagram,
  nodeContent,
  nodeShape,
} from "@quorumind/core/diagram";
import { useId, useMemo } from "react";
import { useTranslation } from "react-i18next";

/**
 * A proposal's architecture as an SVG diagram, laid out by the core so it matches the exports.
 * Colors come from CSS variables (light and dark themes); wide diagrams scroll sideways on small
 * screens. Screen readers get its title, then a visually hidden list of the components and flows.
 */
export function ArchitectureDiagram({
  components,
  flows,
  title,
}: {
  /** Absent on proposals stored before diagrams existed: nothing is rendered then. */
  components?: DiagramComponent[];
  flows?: DiagramFlow[];
  title: string;
}) {
  const { t, i18n } = useTranslation();
  const rtl = i18n.dir() === "rtl";
  const id = useId().replace(/:/g, "");
  const layout = useMemo(() => layoutDiagram(components ?? [], flows ?? [], { rtl }), [components, flows, rtl]);
  if (!components || components.length === 0) return null;
  const names = new Map(components.map((component) => [component.id, component.label]));
  const label = t("diagram.label", { title });

  return (
    <figure className="diagram">
      <div className="diagram-scroll">
        <svg viewBox={`0 0 ${layout.width} ${layout.height}`} width={layout.width} height={layout.height} role="img" aria-label={label}>
          <defs>
            <marker id={`${id}-arrow`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 1L9 5L0 9z" className="diagram-arrow" />
            </marker>
          </defs>
          {layout.edges.map((edge) => (
            // Two edges never share a path: ports are spread along the sides of the boxes.
            <path key={edgePath(edge)} d={edgePath(edge)} className="diagram-edge" markerEnd={`url(#${id}-arrow)`} />
          ))}
          {layout.edges.map((edge) =>
            edge.labelBox ? (
              <g key={`${edge.labelBox.x},${edge.labelBox.y}`} className="diagram-edge-label">
                <rect x={edge.labelBox.x} y={edge.labelBox.y} width={edge.labelBox.width} height={edge.labelBox.height} rx="4" />
                {labelLines(edge.labelBox).map((line) => (
                  <text key={line.y} x={line.x} y={line.y} textAnchor="middle" direction={line.direction}>
                    {line.text}
                  </text>
                ))}
              </g>
            ) : null,
          )}
          {layout.nodes.map((node) => {
            const shape = nodeShape(node);
            const content = nodeContent(node, layout.rtl);
            return (
              <g key={node.id} className="diagram-node" data-kind={node.kind}>
                <path d={shape.body} className="diagram-box" />
                {shape.detail ? <path d={shape.detail} className="diagram-detail" /> : null}
                <path
                  d={KIND_ICONS[node.kind]}
                  className="diagram-icon"
                  transform={`translate(${content.icon.x} ${content.icon.y}) scale(${content.icon.scale})`}
                />
                {content.lines.map((line) => (
                  <text key={line.y} x={line.x} y={line.y} textAnchor={line.anchor} direction={line.direction}>
                    {line.text}
                  </text>
                ))}
              </g>
            );
          })}
        </svg>
      </div>
      <div className="visually-hidden">
        <p>{t("diagram.components")}</p>
        <ul>
          {layout.nodes.map((node) => (
            <li key={node.id}>
              {node.label} ({t(`diagram.kind.${node.kind}`)})
            </li>
          ))}
        </ul>
        <p>{t("diagram.flows")}</p>
        <ul>
          {(flows ?? []).map((flow, index) => {
            const from = names.get(flow.from) ?? flow.from;
            const to = names.get(flow.to) ?? flow.to;
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: two flows can share their ends and label.
              <li key={index}>
                {flow.label ? t("diagram.flow", { from, to, label: flow.label }) : t("diagram.flowUnlabelled", { from, to })}
              </li>
            );
          })}
        </ul>
      </div>
    </figure>
  );
}
