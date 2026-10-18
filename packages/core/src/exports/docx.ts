import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { type Branding, imageSize, isAccent, parseLogo, QUORUMIND_ACCENT } from "../branding.ts";
import { type Locale, localeInfo } from "../locales.ts";
import { chosenOption, formatRange, methodNotes, modeName, participants, reportLabels, seatName, sessionProbes } from "../report.ts";
import type { Proposal } from "../schemas.ts";
import { currentProposals, type Session } from "../session.ts";

// The decision report as a Word document, for people who edit and forward reports by e-mail.
// Server-only: the `docx` package is large, so this module has its own subpath export
// (@quorumind/core/docx) and the web bundle never imports it. Architecture diagrams are listed as
// components and flows: Word needs a raster fallback for SVG, which would require an image library.

const INK = "141A3A";
const MUTED = "535A78";
const LINE = "D9DCE8";
const SOFT = "F6F7FB";

/** Word picks a font per script slot: Latin, East Asian and complex scripts (Arabic, Devanagari). */
const FONTS: Partial<Record<Locale, { eastAsia?: string; cs?: string }>> = {
  ja: { eastAsia: "Yu Gothic" },
  "zh-Hans": { eastAsia: "Microsoft YaHei" },
  ar: { cs: "Arial" },
  hi: { cs: "Nirmala UI" },
};

const LANGUAGE_TAGS: Record<Locale, string> = {
  en: "en-US",
  fr: "fr-FR",
  es: "es-ES",
  pt: "pt-BR",
  it: "it-IT",
  de: "de-DE",
  hi: "hi-IN",
  ja: "ja-JP",
  "zh-Hans": "zh-CN",
  ar: "ar-SA",
};

export async function renderDocx(session: Session, branding: Branding): Promise<Uint8Array> {
  const t = reportLabels(session.locale);
  const rtl = localeInfo(session.locale).dir === "rtl";
  const accent = (branding.accent && isAccent(branding.accent) ? branding.accent : QUORUMIND_ACCENT).slice(1).toUpperCase();
  const verdict = session.verdict;
  const sheet = session.sheet;
  const proposals = currentProposals(session);
  const chosen = chosenOption(session);
  const project = sheet?.projectName ?? session.idea;
  const date = new Intl.DateTimeFormat(session.locale, { dateStyle: "long" }).format(new Date(session.updatedAt));
  const range = (value: { low: number; high: number; currency: string }) => formatRange(value, session.locale);

  type RunStyle = { bold?: boolean; italics?: boolean; color?: string; size?: number };
  const run = (text: string, style: RunStyle = {}) => new TextRun({ text, rightToLeft: rtl, ...style });
  const para = (
    content: string | TextRun[],
    options: { style?: RunStyle; heading?: (typeof HeadingLevel)[keyof typeof HeadingLevel]; spacing?: number } = {},
  ) =>
    new Paragraph({
      children: typeof content === "string" ? [run(content, options.style)] : content,
      bidirectional: rtl,
      ...(options.heading ? { heading: options.heading } : {}),
      spacing: { after: options.spacing ?? 120 },
    });
  const heading = (text: string, level: 1 | 2 | 3 = 1) =>
    para(text, { heading: level === 1 ? HeadingLevel.HEADING_1 : level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3 });
  const bullets = (items: string[]) =>
    items.map((item) => new Paragraph({ children: [run(item)], bullet: { level: 0 }, bidirectional: rtl, spacing: { after: 60 } }));
  const labelled = (label: string, value: string) => para([run(`${label}: `, { bold: true }), run(value)]);
  const border = { style: BorderStyle.SINGLE, size: 4, color: LINE };
  const cell = (content: string | Paragraph[], header = false) =>
    new TableCell({
      children:
        typeof content === "string"
          ? [para(content, { style: header ? { bold: true, color: MUTED, size: 18 } : {}, spacing: 0 })]
          : content,
      margins: { top: 80, bottom: 80, left: 100, right: 100 },
      ...(header ? { shading: { type: ShadingType.CLEAR, fill: SOFT, color: "auto" } } : {}),
    });
  const table = (headers: string[], rows: (string | Paragraph[])[][]) =>
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      visuallyRightToLeft: rtl,
      borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
      rows: [
        new TableRow({ tableHeader: true, children: headers.map((header) => cell(header, true)) }),
        ...rows.map((row) => new TableRow({ cantSplit: true, children: row.map((value) => cell(value)) })),
      ],
    });

  const children: (Paragraph | Table)[] = [];

  // Masthead: the agency's logo and name when branded, Quorumind's name otherwise.
  const logo = branding.logoDataUrl ? parseLogo(branding.logoDataUrl) : null;
  const brandRuns: (TextRun | ImageRun)[] = [];
  if (logo && logo.type !== "image/svg+xml") {
    const size = imageSize(logo.type, logo.bytes) ?? { width: 160, height: 40 };
    const ratio = size.width / Math.max(1, size.height);
    const width = Math.min(200, Math.round(ratio * 40));
    brandRuns.push(
      new ImageRun({
        type: logo.type === "image/png" ? "png" : "jpg",
        data: logo.bytes,
        transformation: { width, height: Math.max(1, Math.round(width / ratio)) },
      }),
    );
    if (branding.name) brandRuns.push(run("  "));
  }
  const brandName = branding.name ?? (logo ? null : "Quorumind");
  if (brandName) brandRuns.push(run(brandName, { bold: true, size: 28, color: INK }));
  children.push(new Paragraph({ children: brandRuns, bidirectional: rtl, spacing: { after: 240 } }));

  children.push(para(t.title.toUpperCase(), { style: { bold: true, color: MUTED, size: 18 }, spacing: 40 }));
  children.push(new Paragraph({ children: [run(project)], heading: HeadingLevel.TITLE, bidirectional: rtl }));
  children.push(para(`${date} · ${t.mode}: ${modeName(session, t)}`, { style: { color: MUTED } }));
  if (sheet) children.push(para(sheet.summary, { style: { color: MUTED } }));

  if (verdict) {
    children.push(heading(t.recommendation));
    if (chosen) {
      children.push(
        para([
          run(`${seatName(chosen.seat, t)}${chosen.proposal ? `: ${chosen.proposal.title}` : ""}`, { bold: true, size: 26, color: accent }),
        ]),
      );
    } else children.push(para(t.noRecommendation, { style: { bold: true } }));
    children.push(para(verdict.recommendation.rationale));
    if (chosen?.proposal) {
      const proposal = chosen.proposal;
      children.push(labelled(`${t.monthlyCost} (${t.estimate})`, range(proposal.monthlyCost)));
      if (proposal.buildCost) children.push(labelled(`${t.buildCost} (${t.estimate})`, range(proposal.buildCost)));
      children.push(labelled(t.buildTime, proposal.buildTime));
    }

    const criteria = sheet?.priorities.map((priority) => priority.criterion) ?? [];
    children.push(heading(t.options));
    children.push(
      table(
        [t.option, t.feasibility, ...criteria],
        verdict.options.map((option) => [
          [para([run(`${seatName(option.seat, t)}: `, { bold: true }), run(option.title)], { spacing: 0 })],
          [
            para(t[option.feasibility], { style: { bold: true }, spacing: 40 }),
            para(option.reason, { style: { size: 18, color: MUTED }, spacing: 40 }),
            ...(option.conditions.length > 0
              ? [para(`${t.conditions}: ${option.conditions.join("; ")}`, { style: { size: 18, color: MUTED }, spacing: 0 })]
              : []),
          ],
          ...criteria.map((criterion) => {
            const value = option.scores.find((score) => score.criterion === criterion)?.score;
            return value ? `${"●".repeat(value)}${"○".repeat(5 - value)} ${value}/5` : "–";
          }),
        ]),
      ),
    );

    const topics = verdict.topics ?? [];
    if (topics.length > 0) {
      children.push(heading(t.debateMap));
      for (const [status, title] of [
        ["agreement", t.consensus],
        ["divided", t.divided],
        ["opposed", t.opposed],
      ] as const) {
        const group = topics.filter((topic) => topic.status === status);
        if (group.length === 0) continue;
        children.push(heading(title, 2));
        for (const topic of group) {
          children.push(para(topic.topic, { style: { bold: true }, spacing: 60 }));
          children.push(...bullets(topic.positions.map((item) => `${item.seat ? `${seatName(item.seat, t)}: ` : ""}${item.position}`)));
        }
      }
    }
  }

  for (const probe of sessionProbes(session)) {
    children.push(heading(t.probe));
    children.push(para(probe.data.angle, { style: { bold: true, italics: true } }));
    children.push(labelled(t.probeRationale, probe.data.rationale));
  }

  if (verdict) {
    if (verdict.risks.length > 0) {
      children.push(heading(t.risks));
      children.push(
        table(
          [t.risks, t.likelihood, t.impact, t.mitigation],
          verdict.risks.map((risk) => [risk.risk, t[risk.likelihood], t[risk.impact], risk.mitigation]),
        ),
      );
    }
    if (verdict.roadmap.length > 0) {
      children.push(heading(t.roadmap));
      verdict.roadmap.forEach((phase, index) => {
        children.push(para([run(`${index + 1}. ${phase.phase}: `, { bold: true }), run(phase.content)], { spacing: 40 }));
        children.push(para(`${t.exitCriterion}: ${phase.exitCriterion}`, { style: { color: MUTED, size: 18 } }));
      });
    }
    if (verdict.claims.length > 0) {
      children.push(heading(t.claims));
      children.push(...bullets(verdict.claims.map((claim) => `${claim.claim} (${t[claim.confidence]})`)));
    }
    if (verdict.openQuestions.length > 0) {
      children.push(heading(t.openQuestions));
      children.push(...bullets(verdict.openQuestions));
    }
  }

  const seats = Object.keys(proposals);
  if (seats.length > 0) {
    children.push(heading(session.mode === "challenge" ? t.yourSolution : t.proposals));
    for (const seat of seats) children.push(...proposalBlocks(seat, proposals[seat] as Proposal));
  }

  if (sheet) {
    children.push(heading(t.requirements));
    for (const [title, items] of [
      [t.goals, sheet.goals],
      [t.mustHave, sheet.mustHave],
      [t.hardConstraints, sheet.hardConstraints],
      [t.outOfScope, sheet.outOfScope],
      [t.priorities, sheet.priorities.map((priority) => `${priority.criterion} (${priority.weight}/5)`)],
      [t.assumptions, sheet.assumptions],
    ] as [string, string[]][]) {
      if (items.length === 0) continue;
      children.push(heading(title, 3), ...bullets(items));
    }
  }

  const answers = session.debate.flatMap((entry) => (entry.kind === "answers" ? entry.answers : []));
  if (answers.length > 0) {
    children.push(heading(t.answers));
    children.push(...bullets(answers.map((entry) => `${entry.question} → ${entry.answer}`)));
  }

  children.push(heading(t.method));
  for (const note of methodNotes(session, t)) children.push(para(note, { style: { color: MUTED, size: 18 } }));
  children.push(...bullets(participants(session, t).map((item) => `${item.role}: ${item.model}`)));

  function proposalBlocks(seat: string, proposal: Proposal): (Paragraph | Table)[] {
    const components = proposal.components ?? [];
    const names = new Map(components.map((component) => [component.id, component.label]));
    const blocks: (Paragraph | Table)[] = [heading(`${seatName(seat, t)}: ${proposal.title}`, 2), para(proposal.summary)];
    blocks.push(labelled(`${t.monthlyCost} (${t.estimate})`, `${range(proposal.monthlyCost)}. ${proposal.monthlyCost.basis}`));
    // Proposals stored before V1 have no build cost, components or flows.
    if (proposal.buildCost)
      blocks.push(labelled(`${t.buildCost} (${t.estimate})`, `${range(proposal.buildCost)}. ${proposal.buildCost.basis}`));
    blocks.push(labelled(t.buildTime, proposal.buildTime), labelled(t.stack, proposal.stack.join(", ")));
    blocks.push(heading(t.architecture, 3), ...bullets(proposal.architecture));
    if (components.length > 0) blocks.push(heading(t.components, 3), ...bullets(components.map((component) => component.label)));
    if ((proposal.flows ?? []).length > 0) {
      blocks.push(
        heading(t.flows, 3),
        ...bullets(
          proposal.flows.map(
            (flow) => `${names.get(flow.from) ?? flow.from} → ${names.get(flow.to) ?? flow.to}${flow.label ? `: ${flow.label}` : ""}`,
          ),
        ),
      );
    }
    blocks.push(heading(t.infrastructure, 3), ...bullets(proposal.infrastructure));
    if (proposal.risks.length > 0) blocks.push(heading(t.risks, 3), ...bullets(proposal.risks));
    return blocks;
  }

  const fonts = FONTS[session.locale] ?? {};
  const headingRun = (size: number, color: string) => ({
    run: { size, bold: true, color },
    paragraph: { spacing: { before: 280, after: 120 } },
  });
  const document = new Document({
    creator: branding.name ?? "Quorumind",
    title: `${t.title}: ${project}`,
    description: t.preparedWith,
    styles: {
      default: {
        document: {
          run: {
            size: 21,
            color: INK,
            font: { ascii: "Calibri", hAnsi: "Calibri", eastAsia: fonts.eastAsia ?? "Calibri", cs: fonts.cs ?? "Calibri" },
            language: {
              value: LANGUAGE_TAGS[session.locale],
              eastAsia: LANGUAGE_TAGS[session.locale],
              bidirectional: rtl ? LANGUAGE_TAGS[session.locale] : "ar-SA",
            },
          },
        },
        title: { run: { size: 44, bold: true, color: INK }, paragraph: { spacing: { after: 120 } } },
        heading1: headingRun(30, accent),
        heading2: headingRun(25, INK),
        heading3: headingRun(21, MUTED),
      },
    },
    sections: [
      {
        properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1000, bottom: 1000, left: 1000, right: 1000 } } },
        footers: {
          default: new Footer({
            // The attribution stays on branded documents: Quorumind is AGPL software.
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                bidirectional: rtl,
                children: [run(`${branding.name ? `${branding.name} · ` : ""}${t.preparedWith}`, { size: 16, color: MUTED })],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });
  return new Uint8Array(await Packer.toArrayBuffer(document));
}
