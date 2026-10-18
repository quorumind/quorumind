// Turns a web page into readable text: enough structure (headings, lists, paragraphs, table rows) for a
// model to follow, none of the chrome (scripts, styles, navigation, footers). A small, careful converter
// rather than a DOM library: the input is untrusted and the output is only ever read as data.

/** Elements dropped with everything inside them (scripts and styles go first, before code is set aside). */
const DROPPED = "svg math iframe object canvas nav footer select button".split(" ");

/** Elements that start a new block of text. */
const BLOCKS =
  "address|article|aside|blockquote|body|caption|center|dd|details|dialog|div|dl|dt|fieldset|figcaption|figure|form|header|hr|html|legend|main|ol|p|pre|section|summary|table|tbody|tfoot|thead|ul";

// Latin-1 entities, in code point order from U+00A0.
const LATIN1 =
  "nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml";

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  OElig: "Œ",
  oelig: "œ",
  Scaron: "Š",
  scaron: "š",
  Yuml: "Ÿ",
  fnof: "ƒ",
  circ: "ˆ",
  tilde: "˜",
  ensp: " ",
  emsp: " ",
  thinsp: " ",
  zwnj: "",
  zwj: "",
  lrm: "",
  rlm: "",
  ndash: "–",
  mdash: "—",
  lsquo: "‘",
  rsquo: "’",
  sbquo: "‚",
  ldquo: "“",
  rdquo: "”",
  bdquo: "„",
  dagger: "†",
  Dagger: "‡",
  bull: "•",
  hellip: "…",
  permil: "‰",
  prime: "′",
  Prime: "″",
  lsaquo: "‹",
  rsaquo: "›",
  euro: "€",
  trade: "™",
  larr: "←",
  uarr: "↑",
  rarr: "→",
  darr: "↓",
  harr: "↔",
  le: "≤",
  ge: "≥",
  ne: "≠",
  minus: "−",
  infin: "∞",
  check: "✓",
};
LATIN1.split(" ").forEach((name, index) => {
  ENTITIES[name] = String.fromCodePoint(0xa0 + index);
});

/** Named references that browsers still decode without their semicolon. */
const LEGACY = new Set(["amp", "lt", "gt", "quot", "nbsp", "copy", "reg"]);

/** Decodes named and numeric character references; unknown ones stay as written. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#\d{1,7}|#x[\da-f]{1,6}|[a-z][a-z\d]{1,31})(;?)/gi, (match, ref: string, semicolon: string) => {
    if (ref[0] === "#") {
      const code = ref[1] === "x" || ref[1] === "X" ? Number.parseInt(ref.slice(2), 16) : Number(ref.slice(1));
      if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return "\uFFFD";
      return String.fromCodePoint(code);
    }
    if (!Object.hasOwn(ENTITIES, ref) || (!semicolon && !LEGACY.has(ref))) return match;
    return ENTITIES[ref] as string;
  });
}

/** Matches the end of a tag name, so that <nav> does not match <nav-menu>. */
const NAME_END = "(?=[\\s/>])";

/**
 * The content of an element up to its closing tag, stopping at the next opening tag of the same
 * name, so that a page full of unclosed elements is scanned once rather than once per element.
 */
const until = (tag: string) => `((?:(?!<${tag}${NAME_END})[\\s\\S])*?)`;

/** Removes every <tag …>…</tag> element, nested ones included. */
function dropElements(html: string, tags: string[]): string {
  const pattern = new RegExp(`<(${tags.join("|")})${NAME_END}[^>]*>(?:(?!<\\1${NAME_END})[\\s\\S])*?</\\1\\s*>`, "gi");
  let out = html;
  // Innermost first: repeat until a pass removes nothing.
  for (let pass = 0; pass < 20; pass++) {
    const next = out.replace(pattern, " ");
    if (next === out) break;
    out = next;
  }
  // An element left open runs to the end of the page.
  return out.replace(new RegExp(`<(${tags.join("|")})${NAME_END}[^>]*>[\\s\\S]*$`, "i"), " ");
}

/** The content of the first <tag>…</tag>, if the page has exactly one. */
function only(html: string, tag: string): string | null {
  const matches = [...html.matchAll(new RegExp(`<${tag}${NAME_END}[^>]*>${until(tag)}</${tag}\\s*>`, "gi"))];
  return matches.length === 1 ? (matches[0]?.[1] ?? null) : null;
}

const inline = (html: string) =>
  decodeEntities(html.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();

export interface HtmlText {
  title: string;
  text: string;
}

/** Marks the place of a preformatted block while the rest of the page is flattened. */
const SLOT = "\uE000";
/** The title is looked for near the top: a page is not searched end to end for it. */
const TITLE_SEARCH_CHARS = 200_000;

export function htmlToText(html: string): HtmlText {
  let body = html
    .replace(/<!--[\s\S]*?(?:-->|$)/g, " ")
    .replace(/<!\[CDATA\[[\s\S]*?(?:\]\]>|$)/g, " ")
    // A "<" that no ">" closes before the next "<" is text. Every tag pattern below then stops at its own ">".
    .replace(/<(?![^<>]*>)/g, "&lt;");
  const top = body.slice(0, TITLE_SEARCH_CHARS);
  const title =
    inline(new RegExp(`<title${NAME_END}[^>]*>${until("title")}</title\\s*>`, "i").exec(top)?.[1] ?? "") ||
    inline(/<meta\s[^>]*property=["']og:title["'][^>]*content=["']([^"']*)["']/i.exec(top)?.[1] ?? "") ||
    inline(new RegExp(`<h1${NAME_END}[^>]*>${until("h1")}</h1\\s*>`, "i").exec(top)?.[1] ?? "");

  body = body.replace(new RegExp(`<head${NAME_END}[^>]*>${until("head")}</head\\s*>`, "i"), " ").replace(new RegExp(SLOT, "g"), "");
  body = dropElements(body, ["script", "style", "noscript", "template", "title"]);
  // Code keeps its line breaks and indentation, and all its text (highlighters wrap names in any element).
  const blocks: string[] = [];
  body = body.replace(new RegExp(`<pre${NAME_END}[^>]*>${until("pre")}</pre\\s*>`, "gi"), (_, content: string) => {
    const code = decodeEntities(content.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]*>/g, ""))
      .replace(/\r\n?/g, "\n")
      .replace(/^\n+|\s+$/g, "");
    blocks.push(code);
    return `\n\n${SLOT}${blocks.length - 1}${SLOT}\n\n`;
  });
  body = dropElements(body, DROPPED);
  // The main content, when the page marks it, leaves out sidebars and banners.
  body = only(body, "main") ?? only(body, "article") ?? body;

  const text = body
    .replace(new RegExp(`<h([1-6])${NAME_END}[^>]*>${until("h[1-6]")}</h\\1\\s*>`, "gi"), (_, level: string, content: string) => {
      const heading = inline(content);
      return heading ? `\n\n${"#".repeat(Number(level))} ${heading}\n\n` : "\n\n";
    })
    .replace(new RegExp(`<li${NAME_END}[^>]*>`, "gi"), "\n- ")
    // Adjacent links ("Docs</a><a>Blog") are separate words.
    .replace(/<\/a\s*>(?=\s*<a[\s>])/gi, " ")
    .replace(new RegExp(`<(?:br|hr)${NAME_END}[^>]*>`, "gi"), "\n")
    .replace(new RegExp(`</?(?:td|th)${NAME_END}[^>]*>`, "gi"), " | ")
    .replace(new RegExp(`<tr${NAME_END}[^>]*>`, "gi"), "\n")
    .replace(/<\/tr\s*>/gi, "")
    .replace(new RegExp(`</?(?:${BLOCKS})${NAME_END}[^>]*>`, "gi"), "\n\n")
    .replace(/<[^>]*>/g, "");

  const lines = decodeEntities(text)
    .split("\n")
    .map((line) =>
      line
        .replace(/[^\S\n]+/g, " ")
        // Runs of empty cells first, so that trimming the edges never rescans a long run.
        .replace(/( ?\|){2,}/g, " |")
        .replace(/^ ?\| ?| ?\| ?$/g, "")
        .trim(),
    );
  return {
    title,
    text: lines
      .join("\n")
      .replace(/\n(- *\n)+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .replace(new RegExp(`${SLOT}(\\d+)${SLOT}`, "g"), (_, index: string) => {
        const code = blocks[Number(index)] ?? "";
        return code.trim() ? `\`\`\`\n${code}\n\`\`\`` : "";
      }),
  };
}
