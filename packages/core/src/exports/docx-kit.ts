import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  ImageRun,
  Packer,
  PageBreak,
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

// The building blocks of every Word export (the decision report, the client proposal, the questionnaire): real
// headings and list styles, plain tables and text runs, so the documents stay editable in Word and Google Docs.

export const INK = "141A3A";
export const MUTED = "535A78";
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

const NUMBERED = "numbered";

export type RunStyle = { bold?: boolean; italics?: boolean; color?: string; size?: number };
export type Block = Paragraph | Table;

export function docxKit(locale: Locale, branding: Branding) {
  const rtl = localeInfo(locale).dir === "rtl";
  const accent = (branding.accent && isAccent(branding.accent) ? branding.accent : QUORUMIND_ACCENT).slice(1).toUpperCase();

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
  const numbered = (items: string[]) =>
    items.map(
      (item) =>
        new Paragraph({ children: [run(item)], numbering: { reference: NUMBERED, level: 0 }, bidirectional: rtl, spacing: { after: 60 } }),
    );
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
  const pageBreak = () => new Paragraph({ children: [new PageBreak()] });

  /** The agency's logo and name when branded, Quorumind's name otherwise. */
  const masthead = (logoHeight = 40) => {
    const logo = branding.logoDataUrl ? parseLogo(branding.logoDataUrl) : null;
    const runs: (TextRun | ImageRun)[] = [];
    if (logo && logo.type !== "image/svg+xml") {
      const pixels = imageSize(logo.type, logo.bytes) ?? { width: 160, height: 40 };
      const ratio = pixels.width / Math.max(1, pixels.height);
      const width = Math.min(logoHeight * 5, Math.round(ratio * logoHeight));
      runs.push(
        new ImageRun({
          type: logo.type === "image/png" ? "png" : "jpg",
          data: logo.bytes,
          transformation: { width, height: Math.max(1, Math.round(width / ratio)) },
          altText: { name: branding.name ?? "Logo", description: branding.name ?? "Logo", title: branding.name ?? "Logo" },
        }),
      );
      if (branding.name) runs.push(run("  "));
    }
    const name = branding.name ?? (logo ? null : "Quorumind");
    if (name) runs.push(run(name, { bold: true, size: 28, color: INK }));
    return new Paragraph({ children: runs, bidirectional: rtl, spacing: { after: 240 } });
  };

  /** The Word file: A4, the document's language and fonts, the headings in the accent color, a footer line. */
  const document = async (options: { title: string; description: string; footer: string; children: Block[] }) => {
    const fonts = FONTS[locale] ?? {};
    const headingRun = (size: number, color: string) => ({
      run: { size, bold: true, color },
      paragraph: { spacing: { before: 280, after: 120 }, keepNext: true },
    });
    const file = new Document({
      creator: branding.name ?? "Quorumind",
      title: options.title,
      description: options.description,
      numbering: {
        config: [
          {
            reference: NUMBERED,
            levels: [{ level: 0, format: "decimal", text: "%1.", alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT }],
          },
        ],
      },
      styles: {
        default: {
          document: {
            run: {
              size: 21,
              color: INK,
              font: { ascii: "Calibri", hAnsi: "Calibri", eastAsia: fonts.eastAsia ?? "Calibri", cs: fonts.cs ?? "Calibri" },
              language: {
                value: LANGUAGE_TAGS[locale],
                eastAsia: LANGUAGE_TAGS[locale],
                bidirectional: rtl ? LANGUAGE_TAGS[locale] : "ar-SA",
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
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  bidirectional: rtl,
                  children: [run(options.footer, { size: 16, color: MUTED })],
                }),
              ],
            }),
          },
          children: options.children,
        },
      ],
    });
    return new Uint8Array(await Packer.toArrayBuffer(file));
  };

  return { rtl, accent, run, para, heading, bullets, numbered, labelled, cell, table, pageBreak, masthead, document };
}
