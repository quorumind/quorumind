// The layout of every e-mail Quorumind sends, the self-hosted server's notifications and the hosted service's
// messages alike: an HTML part that holds up in Gmail, Outlook (its Word renderer included), Apple Mail and on a
// phone, and a plain-text part with the same content. Every value is text: it is escaped here, so a name or a
// title someone typed can never become markup.

/** Who sends the e-mail, as its header and footer show it. */
export interface MailBrand {
  name: string;
  /** A hosted https image of the logo, at least 64 px square. Without one, the name is drawn in the brand's colours. */
  logoUrl?: string | null;
  /** The site or server the footer links to. */
  siteUrl?: string | null;
  /** The address people can write to. */
  contact?: string | null;
}

export interface MailLink {
  label: string;
  url: string;
}

export interface MailFact {
  label: string;
  value: string;
}

export interface MailContent {
  /** The language of the text, as a BCP 47 tag (the lang attribute). */
  lang: string;
  dir: "ltr" | "rtl";
  subject: string;
  /** The line mail clients show after the subject in the inbox. */
  preheader: string;
  heading: string;
  /** What the e-mail is about (a debate's title, a workspace), set apart under the heading. */
  highlight?: string | null;
  paragraphs: string[];
  facts?: MailFact[];
  /** The one thing to do: a button, and its address as text for clients that drop buttons. */
  action?: MailLink | null;
  /** The line above the address of the action: "If the button does not work, copy this link…". */
  linkHint?: string;
  /** Paragraphs after the button. */
  closing?: string[];
  /** Other addresses worth keeping (the terms), as text links. */
  links?: MailLink[];
  signature?: string | null;
  /** Why the person gets this e-mail. */
  footer: string[];
}

export interface RenderedMail {
  subject: string;
  html: string;
  text: string;
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ESCAPES[character] ?? character);
}

/** Only web addresses become links: a javascript: or data: address someone slipped in never does. */
function safeUrl(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error(`Not a web address: ${parsed.protocol}`);
  return url;
}

/** One line for a subject or a title: no line breaks or invisible controls, not too long. */
export function oneLine(value: string, max = 80): string {
  const line = value
    .replace(/[\p{Cc}\p{Cf}\u2028\u2029]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

/** "label: value" with the language's own punctuation: a no-break space before the colon in French. */
export function withColon(lang: string, label: string): string {
  if (lang.startsWith("fr")) return `${label}\u00a0:`;
  if (lang.startsWith("ja") || lang.startsWith("zh")) return `${label}：`;
  return `${label}:`;
}

// The "Contrepoint" palette of the interface: light by default, its dark variant where the client supports it.
const LIGHT = {
  page: "#f6f7fb",
  card: "#ffffff",
  line: "#d9dce8",
  ink: "#141a3a",
  muted: "#535a78",
  link: "#2b44c4",
  soft: "#e4e8fa",
  button: "#2b44c4",
  onButton: "#ffffff",
  antithesis: "#d9502f",
};
const DARK = {
  page: "#0e1121",
  card: "#161a2e",
  line: "#2a2f48",
  ink: "#e8eaf6",
  muted: "#9ea4c2",
  link: "#8ea0f5",
  soft: "#1a2250",
  button: "#4a5fd8",
  antithesis: "#f48c6e",
};

// System fonts only: Latin, Arabic, Devanagari, Japanese and Chinese all have one on every platform.
const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', 'Hiragino Sans', 'PingFang SC', 'Microsoft YaHei', 'Yu Gothic', Meiryo, 'Nirmala UI', 'Noto Sans Arabic', Tahoma, sans-serif";

const STYLE = `
:root { color-scheme: light dark; supported-color-schemes: light dark; }
body { margin: 0 !important; padding: 0 !important; width: 100% !important; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
table, td { border-collapse: collapse; mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
img { border: 0; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic; }
a[x-apple-data-detectors] { color: inherit !important; text-decoration: none !important; }
@media screen and (max-width: 620px) {
  .qm-outer { padding: 20px 12px !important; }
  .qm-card { padding: 28px 20px !important; }
  .qm-heading { font-size: 22px !important; line-height: 30px !important; }
  .qm-button-table { width: 100% !important; }
  .qm-button-link { display: block !important; }
}
@media (prefers-color-scheme: dark) {
  .qm-page { background-color: ${DARK.page} !important; }
  .qm-card { background-color: ${DARK.card} !important; border-color: ${DARK.line} !important; border-top-color: ${DARK.button} !important; }
  .qm-ink { color: ${DARK.ink} !important; }
  .qm-muted { color: ${DARK.muted} !important; }
  .qm-link { color: ${DARK.link} !important; }
  .qm-soft { background-color: ${DARK.soft} !important; border-color: ${DARK.link} !important; }
  .qm-rule { border-color: ${DARK.line} !important; }
  .qm-button { background-color: ${DARK.button} !important; }
  .qm-mark { border-color: ${DARK.link} ${DARK.antithesis} ${DARK.antithesis} ${DARK.link} !important; }
}
[data-ogsc] .qm-ink { color: ${DARK.ink} !important; }
[data-ogsc] .qm-muted { color: ${DARK.muted} !important; }
[data-ogsc] .qm-link { color: ${DARK.link} !important; }
[data-ogsb] .qm-page { background-color: ${DARK.page} !important; }
[data-ogsb] .qm-card { background-color: ${DARK.card} !important; }
[data-ogsb] .qm-soft { background-color: ${DARK.soft} !important; }
`;

const text = (value: string) => escapeHtml(value).replace(/\n/g, "<br>");

/** The brand at the top: the hosted logo, or a ring in the brand's two colours (not in Outlook, which squares it). */
function header(brand: MailBrand, start: string): string {
  const name = `<td class="qm-ink" style="font-family:${FONT};font-size:20px;line-height:28px;font-weight:700;letter-spacing:-0.2px;color:${LIGHT.ink};">${escapeHtml(brand.name)}</td>`;
  const mark = brand.logoUrl
    ? `<td style="padding:0;width:36px;"><img src="${escapeHtml(safeUrl(brand.logoUrl))}" width="36" height="36" alt="" style="display:block;width:36px;height:36px;border-radius:8px;"></td><td style="width:10px;font-size:0;line-height:0;">&nbsp;</td>`
    : `<!--[if !mso]><!--><td style="padding:0;width:30px;"><div class="qm-mark" style="width:16px;height:16px;border:5px solid;border-color:${LIGHT.link} ${LIGHT.antithesis} ${LIGHT.antithesis} ${LIGHT.link};border-radius:50%;font-size:0;line-height:0;">&nbsp;</div></td><td style="width:10px;font-size:0;line-height:0;">&nbsp;</td><!--<![endif]-->`;
  return `<tr><td align="${start}" style="padding:0 4px 20px 4px;"><table role="presentation" border="0" cellspacing="0" cellpadding="0" align="${start}"><tr>${mark}${name}</tr></table></td></tr>`;
}

/** The button: a padded table cell, so Outlook's Word renderer keeps its colour and size. */
function button(action: MailLink, start: string): string {
  const url = escapeHtml(safeUrl(action.url));
  return `<table role="presentation" class="qm-button-table" border="0" cellspacing="0" cellpadding="0" align="${start}" style="margin:8px 0 0 0;"><tr><td class="qm-button" align="center" bgcolor="${LIGHT.button}" style="border-radius:8px;background-color:${LIGHT.button};mso-padding-alt:14px 28px;"><a class="qm-button-link" href="${url}" target="_blank" style="display:inline-block;padding:14px 28px;font-family:${FONT};font-size:16px;line-height:20px;font-weight:600;color:${LIGHT.onButton};text-decoration:none;border-radius:8px;mso-padding-alt:0;">${text(action.label)}</a></td></tr></table>`;
}

function paragraph(value: string, start: string, style = ""): string {
  return `<p class="qm-ink" style="margin:0 0 16px 0;font-family:${FONT};font-size:16px;line-height:24px;color:${LIGHT.ink};text-align:${start};${style}">${text(value)}</p>`;
}

// The values someone typed are isolated (dir="auto"): a Latin title keeps its punctuation in an Arabic e-mail.
function facts(items: MailFact[], start: string): string {
  const rows = items
    .map(
      (fact, index) =>
        `<tr><td class="qm-rule" style="padding:10px 0;border-top:${index === 0 ? "0" : `1px solid ${LIGHT.line}`};text-align:${start};"><div class="qm-muted" style="font-family:${FONT};font-size:13px;line-height:18px;color:${LIGHT.muted};">${text(fact.label)}</div><div class="qm-ink" style="font-family:${FONT};font-size:15px;line-height:22px;color:${LIGHT.ink};"><span dir="auto">${text(fact.value)}</span></div></td></tr>`,
    )
    .join("");
  return `<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin:0 0 20px 0;">${rows}</table>`;
}

function highlight(value: string, start: string): string {
  const side = start === "right" ? "border-right" : "border-left";
  return `<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin:0 0 20px 0;"><tr><td class="qm-soft" bgcolor="${LIGHT.soft}" style="background-color:${LIGHT.soft};${side}:4px solid ${LIGHT.link};border-radius:6px;padding:14px 16px;text-align:${start};"><span class="qm-ink" style="font-family:${FONT};font-size:16px;line-height:24px;font-weight:600;color:${LIGHT.ink};" dir="auto">${text(value)}</span></td></tr></table>`;
}

function link(url: string, label?: string): string {
  const href = escapeHtml(safeUrl(url));
  return `<a class="qm-link" href="${href}" target="_blank" style="color:${LIGHT.link};text-decoration:underline;word-break:break-all;">${text(label ?? url)}</a>`;
}

function htmlOf(content: MailContent, brand: MailBrand): string {
  const start = content.dir === "rtl" ? "right" : "left";
  const body: string[] = [
    `<h1 class="qm-ink qm-heading" style="margin:0 0 20px 0;font-family:${FONT};font-size:24px;line-height:32px;font-weight:700;color:${LIGHT.ink};text-align:${start};">${text(content.heading)}</h1>`,
  ];
  if (content.highlight) body.push(highlight(content.highlight, start));
  for (const item of content.paragraphs) body.push(paragraph(item, start));
  if (content.facts?.length) body.push(facts(content.facts, start));
  if (content.action) {
    body.push(button(content.action, start));
    body.push(
      `<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0"><tr><td style="padding:20px 0 4px 0;text-align:${start};"><p class="qm-muted" style="margin:0 0 4px 0;font-family:${FONT};font-size:13px;line-height:20px;color:${LIGHT.muted};">${text(content.linkHint ?? "")}</p><p style="margin:0;font-family:${FONT};font-size:13px;line-height:20px;">${link(content.action.url)}</p></td></tr></table>`,
    );
  }
  const after = [...(content.closing ?? [])];
  if (after.length || content.links?.length || content.signature) {
    body.push(
      `<div class="qm-rule" style="height:0;margin:24px 0 20px 0;border-top:1px solid ${LIGHT.line};font-size:0;line-height:0;">&nbsp;</div>`,
    );
  }
  for (const item of after) body.push(paragraph(item, start, "font-size:15px;line-height:22px;"));
  if (content.links?.length) {
    const lines = content.links.map((item) => `${link(item.url, item.label)}`).join("<br>");
    body.push(`<p style="margin:0 0 16px 0;font-family:${FONT};font-size:15px;line-height:24px;text-align:${start};">${lines}</p>`);
  }
  if (content.signature) body.push(paragraph(content.signature, start, "margin:0;font-size:15px;line-height:22px;"));

  const footer = content.footer.map(
    (line) =>
      `<p class="qm-muted" style="margin:0 0 8px 0;font-family:${FONT};font-size:12px;line-height:18px;color:${LIGHT.muted};">${text(line)}</p>`,
  );
  const signature = [escapeHtml(brand.name)];
  if (brand.contact)
    signature.push(
      `<a class="qm-link" href="mailto:${escapeHtml(brand.contact)}" style="color:${LIGHT.link};text-decoration:none;">${escapeHtml(brand.contact)}</a>`,
    );
  if (brand.siteUrl)
    signature.push(
      `<a class="qm-link" href="${escapeHtml(safeUrl(brand.siteUrl))}" target="_blank" style="color:${LIGHT.link};text-decoration:none;">${escapeHtml(new URL(brand.siteUrl).host)}</a>`,
    );
  footer.push(
    `<p class="qm-muted" style="margin:0;font-family:${FONT};font-size:12px;line-height:18px;color:${LIGHT.muted};">${signature.join(" &nbsp;·&nbsp; ")}</p>`,
  );

  // The preview line, then enough invisible spacing that the body text does not run on after it in the inbox.
  const preheader = `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeHtml(content.preheader)}${"&#847;&zwnj;&nbsp;".repeat(60)}</div>`;

  return `<!DOCTYPE html>
<html lang="${escapeHtml(content.lang)}" dir="${content.dir}" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(content.subject)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><style>td, p, a, h1, span, div { font-family: 'Segoe UI', Arial, sans-serif !important; }</style><![endif]-->
<style>${STYLE}</style>
</head>
<body class="qm-page" bgcolor="${LIGHT.page}" style="margin:0;padding:0;background-color:${LIGHT.page};">
${preheader}
<table role="presentation" class="qm-page" width="100%" border="0" cellspacing="0" cellpadding="0" bgcolor="${LIGHT.page}" style="background-color:${LIGHT.page};" dir="${content.dir}">
<tr><td align="center" class="qm-outer" style="padding:32px 16px;">
<!--[if mso]><table role="presentation" width="600" align="center" border="0" cellspacing="0" cellpadding="0"><tr><td><![endif]-->
<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width:600px;margin:0 auto;" dir="${content.dir}">
${header(brand, start)}
<tr><td class="qm-card" bgcolor="${LIGHT.card}" style="background-color:${LIGHT.card};border:1px solid ${LIGHT.line};border-top:4px solid ${LIGHT.link};border-radius:12px;padding:36px 40px;text-align:${start};">
${body.join("\n")}
</td></tr>
<tr><td align="center" style="padding:24px 16px 8px 16px;text-align:center;">
${footer.join("\n")}
</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>
`;
}

function textOf(content: MailContent, brand: MailBrand): string {
  const blocks: string[] = [content.heading];
  if (content.highlight) blocks.push(content.highlight);
  blocks.push(...content.paragraphs);
  if (content.facts?.length) blocks.push(content.facts.map((fact) => `${withColon(content.lang, fact.label)} ${fact.value}`).join("\n"));
  if (content.action) blocks.push(`${withColon(content.lang, content.action.label)}\n${content.action.url}`);
  blocks.push(...(content.closing ?? []));
  if (content.links?.length) blocks.push(content.links.map((item) => `${withColon(content.lang, item.label)} ${item.url}`).join("\n"));
  if (content.signature) blocks.push(content.signature);
  const signature = [brand.name, brand.contact, brand.siteUrl].filter(Boolean).join(" · ");
  blocks.push(`--\n${[...content.footer, signature].join("\n")}`);
  return `${blocks.join("\n\n")}\n`;
}

/** The e-mail in both forms, for a multipart/alternative message. */
export function renderMail(content: MailContent, brand: MailBrand): RenderedMail {
  return { subject: content.subject.replace(/\s*[\r\n]+\s*/g, " ").trim(), html: htmlOf(content, brand), text: textOf(content, brand) };
}
