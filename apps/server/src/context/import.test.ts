import { createServer, type RequestListener, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { crc32, deflateRawSync, gzipSync } from "node:zlib";
import { MAX_CONTEXT_CHARS } from "@quorumind/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isPublicAddress, parseIPv6 } from "./address.ts";
import { withoutFallbacks, wordText } from "./docx.ts";
import { ContextError } from "./errors.ts";
import { extractInWorker } from "./extract.ts";
import { extractFile } from "./file.ts";
import { fetchGithub, parseGithubUrl, pickDocs } from "./github.ts";
import { decodeEntities, htmlToText } from "./html.ts";
import { CUT_MARKER, cleanWhitespace } from "./text.ts";
import { type FetchOptions, fetchUrl, pinnedLookup, type Resolver } from "./url.ts";

// Fixtures are generated here rather than committed: a few lines each, and easy to vary.

const char = (code: number) => String.fromCharCode(code);

/** A valid PDF with one text line per entry, one page per array, and an image on the first page. */
function makePdf(pages: string[][], trailerExtra = "", extraObject = ""): Uint8Array {
  const objects: string[] = [];
  const pageIds = pages.map((_, i) => 5 + i * 2);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  objects[4] =
    "<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Length 1 >>\nstream\nA\nendstream";
  pages.forEach((lines, i) => {
    const quote = (line: string) => line.replace(/[\\()]/g, "\\$&");
    const image = i === 0 ? "q 50 0 0 50 400 700 cm /Im1 Do Q " : "";
    const text = lines.length ? `BT /F1 12 Tf 72 720 Td 16 TL ${lines.map((line) => `(${quote(line)}) Tj T*`).join(" ")} ET` : "";
    const content = `${image}${text}`;
    objects[5 + i * 2] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> /XObject << /Im1 4 0 R >> >> /Contents ${6 + i * 2} 0 R >>`;
    objects[6 + i * 2] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  });
  if (extraObject) objects.push(extraObject);
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let n = 1; n < objects.length; n++) {
    offsets.push(out.length);
    out += `${n} 0 obj\n${objects[n]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R ${trailerExtra}>>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

/** A zip archive, stored or deflated. */
function makeZip(files: Record<string, string | Uint8Array>, deflate = false): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const raw = typeof content === "string" ? Buffer.from(content, "utf8") : Buffer.from(content);
    const data = deflate ? deflateRawSync(raw) : raw;
    const fileName = Buffer.from(name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt16LE(33, 12); // 1980-01-01
    local.writeUInt32LE(crc32(raw), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(fileName.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(deflate ? 8 : 0, 10);
    central.writeUInt16LE(33, 14);
    central.writeUInt32LE(crc32(raw), 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(fileName.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, fileName, data);
    centrals.push(central, fileName);
    offset += local.length + fileName.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, directory, end]));
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

function makeDocx(body: string, deflate = true): Uint8Array {
  return makeZip(
    {
      "[Content_Types].xml":
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      "_rels/.rels":
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      "word/document.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body}</w:body></w:document>`,
    },
    deflate,
  );
}

const p = (text: string, props = "") =>
  `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ""}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

const table = (rows: string[][]) =>
  `<w:tbl>${rows.map((cells) => `<w:tr>${cells.map((cell) => `<w:tc>${p(cell)}</w:tc>`).join("")}</w:tr>`).join("")}</w:tbl>`;

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ContextError) return error.code;
    throw error;
  }
  return "no error";
}

const encode = (text: string) => new TextEncoder().encode(text);

describe("file extraction", () => {
  it("reads the text of every page of a PDF and ignores its images", async () => {
    const pdf = makePdf([
      ["Cahier des charges: booking platform", "Members book classes online."],
      ["Second page: payments by card", "Reminders by SMS (one day before)."],
    ]);
    const document = await extractFile("cahier des charges.pdf", "application/pdf", pdf);
    expect(document).toMatchObject({ kind: "file", name: "cahier des charges.pdf", source: "cahier des charges.pdf", truncated: false });
    expect(document.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(document.chars).toBe(document.text.length);
    for (const line of ["Cahier des charges: booking platform", "Members book classes online.", "Reminders by SMS (one day before)."]) {
      expect(document.text).toContain(line);
    }
    expect(document.text.indexOf("Members")).toBeLessThan(document.text.indexOf("Second page"));
  });

  it("says a PDF without text is a scan, and a PDF with a password is protected", async () => {
    expect(await codeOf(extractFile("scan.pdf", "application/pdf", makePdf([[], []])))).toBe("scanned");
    const hex = (byte: number) => `<${byte.toString(16).padStart(2, "0").repeat(32)}>`;
    const encrypted = makePdf(
      [["Secret"]],
      `/Encrypt 7 0 R /ID [<${"ab".repeat(16)}> <${"ab".repeat(16)}>] `,
      `<< /Filter /Standard /V 1 /R 2 /O ${hex(0x11)} /U ${hex(0x22)} /P -4 >>`,
    );
    expect(await codeOf(extractFile("locked.pdf", "application/pdf", encrypted))).toBe("encrypted");
  });

  it("reads a Word document with its headings, lists and tables", async () => {
    const docx = makeDocx(
      [
        p("Booking platform", '<w:pStyle w:val="Title"/>'),
        p("Scope", '<w:pStyle w:val="Heading1"/>'),
        p("Members book classes", '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>'),
        p("Studios manage &amp; publish their timetable", '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>'),
        p("Budget", '<w:pStyle w:val="Titre2"/>'),
        table([
          ["Build", "15 000 €"],
          ["Hosting", "400 € a month"],
        ]),
        `<w:p><w:r><w:t>Deadline:</w:t><w:tab/><w:t>June</w:t><w:delText>May</w:delText></w:r></w:p>`,
      ].join(""),
    );
    const document = await extractFile("brief.docx", "", docx);
    expect(document.text).toBe(
      [
        "# Booking platform",
        "",
        "# Scope",
        "",
        "- Members book classes",
        "- Studios manage & publish their timetable",
        "",
        "## Budget",
        "",
        "Build | 15 000 €",
        "",
        "Hosting | 400 € a month",
        "",
        "Deadline: June",
      ].join("\n"),
    );
  });

  it("keeps a single copy of text boxes", () => {
    const box = (text: string) => `<w:txbxContent>${p(text)}</w:txbxContent>`;
    const xml = `<w:document ${W}><w:body><w:p><w:r><mc:AlternateContent><mc:Choice>${box("In a box")}</mc:Choice><mc:Fallback>${box("In a box")}</mc:Fallback></mc:AlternateContent></w:r></w:p></w:body></w:document>`;
    expect(wordText(xml)).toBe("In a box");
    expect(withoutFallbacks("a<mc:Fallback>b</mc:Fallback>c<mc:FallbackX>d</mc:FallbackX><mc:Fallback>e")).toBe(
      "ac<mc:FallbackX>d</mc:FallbackX><mc:Fallback>e",
    );
  });

  it("stays fast on Word documents full of unclosed tags", async () => {
    const started = performance.now();
    wordText("<a".repeat(200_000));
    wordText("<mc:Fallback>".repeat(200_000));
    wordText(`<w:t${"a".repeat(200_000)}`);
    wordText(`<w:p>${"<w:t x".repeat(100_000)}`);
    const rels = makeZip({ "_rels/.rels": "<Relationship".repeat(200_000), "word/document.xml": `<w:document ${W}/>` }, true);
    expect(await codeOf(extractFile("rels.docx", "", rels))).toBe("empty");
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  it("reads PDF and Word documents in a worker stopped at its deadline and its memory cap", async () => {
    const limits = { timeoutMs: 20_000, memoryMb: 24, concurrent: 2 };
    expect((await extractInWorker("docx", makeDocx(p("Hello")), limits)).text).toBe("Hello");
    // 300 000 paragraphs: within the size cap, beyond 24 MB of heap.
    const heavy = makeDocx(p("ab").repeat(300_000));
    expect(heavy.byteLength).toBeLessThan(200 * 1024);
    expect(await codeOf(extractInWorker("docx", heavy, limits))).toBe("too_large");
    expect(await codeOf(extractInWorker("pdf", makePdf([["Slow"]]), { ...limits, memoryMb: 256, timeoutMs: 1 }))).toBe("too_large");
    // More documents than workers: they wait their turn.
    const read = await Promise.all([1, 2, 3].map((n) => extractInWorker("docx", makeDocx(p(`Doc ${n}`)), { ...limits, concurrent: 1 })));
    expect(read.map((document) => document.text)).toEqual(["Doc 1", "Doc 2", "Doc 3"]);
  });

  it("refuses a Word document that would inflate beyond reason, an encrypted one and an old .doc", async () => {
    const bomb = makeZip({ "_rels/.rels": "", "word/document.xml": new Uint8Array(40 * 1024 * 1024) }, true);
    expect(bomb.byteLength).toBeLessThan(200 * 1024);
    expect(await codeOf(extractFile("bomb.docx", "", bomb))).toBe("too_large");
    const compound = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
    expect(await codeOf(extractFile("locked.docx", "", compound))).toBe("encrypted");
    expect(await codeOf(extractFile("old.doc", "application/msword", compound))).toBe("unsupported_type");
  });

  it("reads Markdown and text files, with or without a byte order mark, and legacy encodings", async () => {
    const markdown = await extractFile(
      "notes.md",
      "text/markdown",
      encode(`${char(0xfeff)}# Notes\r\n\r\n\r\n\r\n- one   item\t\n  - nested`),
    );
    expect(markdown.text).toBe("# Notes\n\n- one item\n  - nested");
    const latin = await extractFile("old.txt", "text/plain", new Uint8Array([0x63, 0x61, 0x66, 0xe9])); // "café" in Windows-1252
    expect(latin.text).toBe("café");
  });

  it("refuses other types, impostors, empty and oversized files", async () => {
    expect(await codeOf(extractFile("tool.exe", "application/octet-stream", encode("MZ")))).toBe("unsupported_type");
    expect(await codeOf(extractFile("fake.pdf", "application/pdf", encode("hello")))).toBe("unsupported_type");
    expect(await codeOf(extractFile("fake.docx", "", encode("hello")))).toBe("unsupported_type");
    expect(await codeOf(extractFile("binary.txt", "text/plain", new Uint8Array([1, 0, 2, 0])))).toBe("unsupported_type");
    expect(await codeOf(extractFile("blank.md", "", encode(" \n\t\n ")))).toBe("empty");
    expect(await codeOf(extractFile("big.txt", "", new Uint8Array(10 * 1024 * 1024 + 1)))).toBe("too_large");
  });

  it("keeps MAX_CONTEXT_CHARS characters at most, with a visible marker", async () => {
    const document = await extractFile("long.txt", "", encode(`${"word ".repeat(30_000)}\n`.repeat(3)));
    expect(document.text.length).toBeLessThanOrEqual(MAX_CONTEXT_CHARS);
    expect(document.text.endsWith(CUT_MARKER)).toBe(true);
    expect(document.truncated).toBe(true);
  });

  it("cleans whitespace but keeps the structure", () => {
    expect(cleanWhitespace(`  \n\na  b ${char(0x200b)}\n\n\n\n\tc${char(7)}\r\n`)).toBe("a b\n\n  c");
  });
});

describe("HTML to text", () => {
  const page = `<!doctype html><html><head><title>Studio &amp; Co &mdash; Pricing</title>
    <style>body { color: red }</style><script>alert("x")</script></head>
    <body>
      <nav><a href="/">Home</a><a href="/about">About</a></nav>
      <header><p>Banner</p></header>
      <main>
        <h1>Plans</h1>
        <p>Pick a plan.<br>Cancel any time.</p>
        <h2>What&#8217;s included</h2>
        <ul><li>Unlimited classes</li><li>Caf&eacute; discount &#x1F600;</li></ul>
        <table><tr><th>Plan</th><th>Price</th></tr><tr><td>Basic</td><td>&euro;30</td></tr></table>
        <script>if (a < b) track()</script>
        <!-- <p>hidden comment</p> -->
        <nav-menu>Custom element text</nav-menu>
      </main>
      <footer>© 2026 Studio</footer>
    </body></html>`;

  it("keeps the title, the headings, the lists and the tables, and drops the chrome", () => {
    const { title, text } = htmlToText(page);
    expect(title).toBe("Studio & Co — Pricing");
    expect(text).toBe(
      [
        "# Plans",
        "",
        "Pick a plan.",
        "Cancel any time.",
        "",
        "## What’s included",
        "",
        "- Unlimited classes",
        "- Café discount 😀",
        "",
        "Plan | Price",
        "Basic | €30",
        "",
        "Custom element text",
      ].join("\n"),
    );
  });

  it("drops navigation and footers when the page has no main element", () => {
    const { text } = htmlToText(
      "<body><nav><nav>Menu</nav>More menu</nav><div>Content<script>x</script></div><footer>Legal</footer></body>",
    );
    expect(text).toBe("Content");
  });

  it("keeps code blocks whole, with their indentation", () => {
    const { text } = htmlToText(
      '<main><p>Install:</p><pre class="shiki"><code><span>npm</span> <button class="twoslash-hover">install</button> hono\n  --save &amp;&amp; done</code></pre><button>Copy</button><a>Docs</a><a>Blog</a></main>',
    );
    expect(text).toBe("Install:\n\n```\nnpm install hono\n  --save && done\n```\n\nDocs Blog");
  });

  it("falls back to the first heading for the title and survives broken markup", () => {
    const { title, text } = htmlToText("<body><h1>Spec <em>v2</em></h1><p>Price < 30 €<p>Text<script>never closed");
    expect(title).toBe("Spec v2");
    expect(text).toBe("# Spec v2\n\nPrice < 30 €\n\nText");
  });

  it("stays fast on pages full of unclosed elements", () => {
    const started = performance.now();
    htmlToText(`${"<h1>x<pre>y<main>z<title>t<li ".repeat(40_000)}${"| ".repeat(100_000)}<${"a".repeat(100_000)}`);
    expect(performance.now() - started).toBeLessThan(3_000);
  });

  it("decodes entities carefully", () => {
    expect(decodeEntities("&lt;b&gt; &amp;amp; &#39;x&#39; &unknown; a&b &para=1 &copy 2026 &#0; &#xD800;")).toBe(
      `<b> &amp; 'x' &unknown; a&b &para=1 © 2026 ${char(0xfffd)} ${char(0xfffd)}`,
    );
  });
});

describe("address policy", () => {
  it.each([
    "127.0.0.1",
    "127.1.2.3",
    "10.0.0.1",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "100.127.255.254",
    "0.0.0.0",
    "224.0.0.1",
    "239.255.255.250",
    "255.255.255.255",
    "198.18.0.1",
    "::",
    "::1",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "fe80::1%eth0",
    "fec0::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:169.254.169.254",
    "::ffff:a9fe:a9fe",
    "::ffff:10.0.0.1",
    "::ffff:0:192.168.0.1",
    "64:ff9b::a9fe:a9fe",
    "2002:7f00:1::1",
    "2001:db8::1",
    "2001::1",
    "not an address",
    "",
  ])("refuses %s", (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });

  it.each([
    "8.8.8.8",
    "93.184.216.34",
    "172.32.0.1",
    "100.128.0.1",
    "2606:4700:4700::1111",
    "2a00:1450:4007:80e::200e",
    "::ffff:8.8.8.8",
    "2002:808:808::1",
  ])("accepts %s", (ip) => {
    expect(isPublicAddress(ip)).toBe(true);
  });

  it("parses IPv6 forms", () => {
    expect(parseIPv6("::1")?.at(-1)).toBe(1);
    expect(parseIPv6("[::ffff:1.2.3.4]")?.slice(10)).toEqual([0xff, 0xff, 1, 2, 3, 4]);
    expect(parseIPv6("1::2::3")).toBeNull();
    expect(parseIPv6("1:2:3:4:5:6:7:8:9")).toBeNull();
  });
});

describe("web page import", () => {
  let server: Server | null = null;
  afterEach(() => {
    server?.close();
    server = null;
  });

  /** A local site. Tests treat 127.0.0.1 as public so it can be reached; every other private address stays refused. */
  async function site(handler: RequestListener): Promise<{ port: number; options: (dns?: Record<string, string[]>) => FetchOptions }> {
    server = createServer(handler);
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    return {
      port,
      options: (dns = {}) => ({
        isAllowed: (ip) => ip === "127.0.0.1" || isPublicAddress(ip),
        resolve: async (host) => {
          const addresses = { "site.test": ["127.0.0.1"], ...dns }[host];
          if (!addresses) throw new Error("ENOTFOUND");
          return addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
        },
      }),
    };
  }

  it("refuses private, loopback, link-local and metadata addresses written in the URL", async () => {
    for (const url of [
      "http://127.0.0.1/",
      "http://169.254.169.254/latest/meta-data/",
      "http://metadata.google.internal.169.254.169.254.nip.io.invalid@169.254.169.254/",
      "http://10.0.0.1:8080/",
      "http://100.64.0.1/",
      "http://[::1]/",
      "http://[::ffff:127.0.0.1]/",
      "http://[::ffff:a9fe:a9fe]/",
      "http://[fd00::1]/",
      "http://[fe80::1]/",
      "http://2130706433/",
      "http://0x7f.1/",
      "http://0177.0.0.1/",
      "http://localhost:8787/api/health",
    ]) {
      expect(await codeOf(fetchUrl(url)), url).toBe("blocked_address");
    }
  });

  it("refuses other protocols", async () => {
    for (const url of ["file:///etc/passwd", "ftp://example.com/spec.pdf", "javascript:alert(1)", "gopher://x", "data:text/html,hi"]) {
      expect(await codeOf(fetchUrl(url)), url).toBe("unsupported_type");
    }
  });

  it("refuses a host name when any of its addresses is private", async () => {
    const resolve: Resolver = async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.5", family: 4 },
    ];
    expect(await codeOf(fetchUrl("https://mixed.test/", { resolve }))).toBe("blocked_address");
    const mapped: Resolver = async () => [{ address: "::ffff:169.254.169.254", family: 6 }];
    expect(await codeOf(fetchUrl("https://mapped.test/", { resolve: mapped }))).toBe("blocked_address");
  });

  it("imports a page with its title and readable text, decompressed", async () => {
    const { port, options } = await site((_, res) => {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Encoding": "gzip" });
      res.end(gzipSync("<title>Spec</title><main><h1>Goals</h1><p>Book classes.</p></main>"));
    });
    const document = await fetchUrl(`http://site.test:${port}/spec`, options());
    expect(document).toMatchObject({ kind: "url", name: "Spec", source: `http://site.test:${port}/spec`, truncated: false });
    expect(document.text).toBe("# Goals\n\nBook classes.");
  });

  it("follows at most three redirects and checks every hop", async () => {
    const hits: string[] = [];
    const { port, options } = await site((req, res) => {
      hits.push(req.url ?? "");
      const targets: Record<string, string> = {
        "/metadata": "http://169.254.169.254/latest/meta-data/",
        "/intranet": "http://intranet.test/",
        "/ipv6": "http://[::1]/",
        "/mapped": "http://[::ffff:10.0.0.1]/",
        "/file": "file:///etc/passwd",
        "/ok": "/final",
      };
      const target = targets[req.url ?? ""];
      if (target) {
        res.writeHead(302, { Location: target }).end();
      } else if (req.url?.startsWith("/loop")) {
        res.writeHead(301, { Location: `/loop${hits.length}` }).end();
      } else {
        res.writeHead(200, { "Content-Type": "text/plain" }).end("Final page");
      }
    });
    const opts = options({ "intranet.test": ["10.1.2.3"] });
    for (const path of ["/metadata", "/intranet", "/ipv6", "/mapped"]) {
      expect(await codeOf(fetchUrl(`http://site.test:${port}${path}`, opts)), path).toBe("blocked_address");
    }
    expect(await codeOf(fetchUrl(`http://site.test:${port}/file`, opts))).toBe("unsupported_type");
    expect(await codeOf(fetchUrl(`http://site.test:${port}/loop`, opts))).toBe("fetch_failed");
    expect(hits.filter((hit) => hit.startsWith("/loop"))).toHaveLength(4);
    const document = await fetchUrl(`http://site.test:${port}/ok`, opts);
    expect(document).toMatchObject({ text: "Final page", source: `http://site.test:${port}/final` });
  });

  it("connects only to the address it checked, whatever DNS answers next (DNS rebinding)", async () => {
    const { port } = await site((_, res) => res.writeHead(200, { "Content-Type": "text/plain" }).end("public page"));
    let calls = 0;
    const options: FetchOptions = {
      isAllowed: (ip) => ip === "127.0.0.1" || isPublicAddress(ip),
      // The first answer passes the check; any later one would point to the intranet.
      resolve: async () => [{ address: calls++ === 0 ? "127.0.0.1" : "10.0.0.1", family: 4 }],
      timeoutMs: 2_000,
    };
    const document = await fetchUrl(`http://rebind.test:${port}/`, options);
    expect(document.text).toBe("public page");
    expect(calls).toBe(1);
  });

  it("gives the socket only the checked addresses", async () => {
    const lookup = pinnedLookup([
      { address: "2606:4700:4700::1111", family: 6 },
      { address: "1.1.1.1", family: 4 },
    ]);
    const all = await new Promise((resolve) => lookup("one.test", { all: true }, (_, addresses) => resolve(addresses)));
    expect(all).toHaveLength(2);
    const v4 = await new Promise((resolve) => lookup("one.test", { family: 4 }, (_, address) => resolve(address)));
    expect(v4).toBe("1.1.1.1");
    const none = await new Promise((resolve) =>
      pinnedLookup([{ address: "1.1.1.1", family: 4 }])("x", { family: 6 }, (error) => resolve(error)),
    );
    expect(none).toBeInstanceOf(Error);
  });

  it("lets a self-hoster reach the intranet when allowed", async () => {
    const { port } = await site((_, res) => res.writeHead(200, { "Content-Type": "text/markdown" }).end("# Intranet spec"));
    expect(await codeOf(fetchUrl(`http://127.0.0.1:${port}/spec.md`))).toBe("blocked_address");
    const document = await fetchUrl(`http://127.0.0.1:${port}/spec.md`, { allowPrivate: true });
    expect(document).toMatchObject({ kind: "url", name: "spec.md" });
  });

  it("maps errors, types and sizes", async () => {
    const { port, options } = await site((req, res) => {
      if (req.url === "/missing") res.writeHead(404).end();
      else if (req.url === "/busy") res.writeHead(429).end();
      else if (req.url === "/broken") res.writeHead(500).end();
      else if (req.url === "/image") res.writeHead(200, { "Content-Type": "image/png" }).end("png");
      else if (req.url === "/json") res.writeHead(200, { "Content-Type": "application/json" }).end("{}");
      else if (req.url === "/binary") res.writeHead(200, { "Content-Type": "application/octet-stream" }).end("MZ");
      else if (req.url === "/huge-pdf")
        res.writeHead(200, { "Content-Type": "application/pdf", "Content-Length": String(11 * 1024 * 1024) }).end();
      else if (req.url === "/files/cahier%20des%20charges.pdf")
        res.writeHead(200, { "Content-Type": "application/pdf" }).end(Buffer.from(makePdf([["PDF on the web"]])));
      else if (req.url === "/download")
        res.writeHead(200, { "Content-Type": "application/octet-stream" }).end(Buffer.from(makePdf([["Served as bytes"]])));
      else if (req.url === "/big") res.writeHead(200, { "Content-Type": "text/html" }).end(`<p>${"lorem ipsum ".repeat(400_000)}</p>`);
      else if (req.url === "/empty") res.writeHead(200, { "Content-Type": "text/html" }).end("<script>only()</script>");
      // /slow never answers.
    });
    const url = (path: string) => `http://site.test:${port}${path}`;
    expect(await codeOf(fetchUrl(url("/missing"), options()))).toBe("not_found");
    expect(await codeOf(fetchUrl(url("/busy"), options()))).toBe("rate_limited");
    expect(await codeOf(fetchUrl(url("/broken"), options()))).toBe("fetch_failed");
    expect(await codeOf(fetchUrl(url("/image"), options()))).toBe("unsupported_type");
    expect(await codeOf(fetchUrl(url("/json"), options()))).toBe("unsupported_type");
    expect(await codeOf(fetchUrl(url("/binary"), options()))).toBe("unsupported_type");
    expect(await codeOf(fetchUrl(url("/huge-pdf"), options()))).toBe("too_large");
    expect(await codeOf(fetchUrl(url("/empty"), options()))).toBe("empty");
    expect(await codeOf(fetchUrl(url("/slow"), { ...options(), timeoutMs: 300 }))).toBe("fetch_failed");
    expect(await codeOf(fetchUrl("http://unknown.test/", options()))).toBe("fetch_failed");
    // PDFs go to the PDF extractor.
    const pdf = await fetchUrl(url("/files/cahier%20des%20charges.pdf"), options());
    expect(pdf).toMatchObject({ kind: "url", name: "cahier des charges.pdf", text: "PDF on the web" });
    expect((await fetchUrl(url("/download"), options())).text).toBe("Served as bytes");
    // Pages beyond 3 MB are cut rather than refused.
    const big = await fetchUrl(url("/big"), options());
    expect(big.text.endsWith(CUT_MARKER)).toBe(true);
    expect(big.truncated).toBe(true);
  });
});

describe("GitHub import", () => {
  it("recognises repository addresses", () => {
    expect(parseGithubUrl("https://github.com/honojs/hono")).toEqual({ owner: "honojs", repo: "hono", ref: null, path: "" });
    expect(parseGithubUrl("github.com/honojs/hono.git")).toEqual({ owner: "honojs", repo: "hono", ref: null, path: "" });
    expect(parseGithubUrl("https://www.github.com/honojs/hono/tree/v4/src/middleware")).toEqual({
      owner: "honojs",
      repo: "hono",
      ref: "v4",
      path: "src/middleware",
    });
    expect(parseGithubUrl("https://github.com/honojs/hono/blob/main/src/index.ts")).toMatchObject({ ref: "main", path: "src" });
    expect(parseGithubUrl("https://github.com/honojs/hono/issues/12")).toMatchObject({ ref: null, path: "" });
    expect(parseGithubUrl("https://github.com/honojs/hono/tree/main/a%2F..%2Fb")).toBeNull();
    expect(parseGithubUrl("https://github.com/honojs")).toBeNull();
    expect(parseGithubUrl("https://github.com/settings/profile")).toBeNull();
    expect(parseGithubUrl("https://gitlab.com/a/b")).toBeNull();
    expect(parseGithubUrl("https://github.com.evil.test/a/b")).toBeNull();
  });

  it("picks the key documents and the decision records", () => {
    const { docs, adrs } = pickDocs([
      "ARCHITECTURE.md",
      "CHANGELOG.md",
      "docs/api/endpoints.md",
      "docs/architecture/overview.md",
      "docs/adr/0001-use-postgres.md",
      "docs/adr/0002-use-hono.md",
      "docs/a/b/c/too-deep.md",
      "docs/logo.png",
      "src/README.md",
    ]);
    expect(docs).toEqual(["ARCHITECTURE.md", "docs/architecture/overview.md", "docs/api/endpoints.md"]);
    expect(adrs).toEqual(["docs/adr/0001-use-postgres.md", "docs/adr/0002-use-hono.md"]);
  });

  const repo = {
    full_name: "acme/studio",
    html_url: "https://github.com/acme/studio",
    description: "Booking for yoga studios",
    default_branch: "main",
    homepage: null,
    topics: ["booking"],
    license: { spdx_id: "MIT", name: "MIT License" },
    archived: false,
    fork: false,
    stargazers_count: 42,
    pushed_at: "2026-09-01T10:00:00Z",
  };
  const tree = {
    truncated: false,
    tree: [
      { path: ".github", type: "tree" },
      { path: ".github/workflows", type: "tree" },
      { path: ".github/workflows/ci.yml", type: "blob" },
      { path: "ARCHITECTURE.md", type: "blob", size: 900 },
      { path: "README.md", type: "blob", size: 300 },
      { path: "package.json", type: "blob", size: 200 },
      { path: "Dockerfile", type: "blob", size: 20 },
      { path: "docs", type: "tree" },
      { path: "docs/adr", type: "tree" },
      { path: "docs/adr/0001-use-postgres.md", type: "blob", size: 400 },
      { path: "docs/huge.md", type: "blob", size: 5_000_000 },
      { path: "src", type: "tree" },
      { path: "src/index.ts", type: "blob" },
      { path: "src/routes", type: "tree" },
      { path: "src/routes/deep.ts", type: "blob" },
      { path: "apps/api/package.json", type: "blob" },
    ],
  };

  function mockGithub(overrides: Record<string, () => Response> = {}) {
    const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
    const routes: Record<string, () => Response> = {
      "https://api.github.com/repos/acme/studio": () => json(repo),
      "https://api.github.com/repos/acme/studio/languages": () => json({ TypeScript: 9_000, CSS: 900, Shell: 50 }),
      "https://api.github.com/repos/acme/studio/git/trees/main?recursive=1": () => json(tree),
      "https://raw.githubusercontent.com/acme/studio/main/README.md": () => new Response("# Studio\n\nBook classes."),
      "https://raw.githubusercontent.com/acme/studio/main/package.json": () =>
        new Response('{ "name": "studio", "dependencies": { "hono": "4" } }'),
      "https://raw.githubusercontent.com/acme/studio/main/Dockerfile": () => new Response("FROM node:22"),
      "https://raw.githubusercontent.com/acme/studio/main/ARCHITECTURE.md": () => new Response("One Hono API, one SQLite file."),
      "https://raw.githubusercontent.com/acme/studio/main/docs/adr/0001-use-postgres.md": () =>
        new Response("# Use PostgreSQL\n\nAccepted."),
      ...overrides,
    };
    return vi.fn(async (input: string | URL | Request) => (routes[String(input)] ?? (() => new Response("", { status: 404 })))());
  }

  it("describes the codebase from the API without a token", async () => {
    const fetch = mockGithub();
    const document = await fetchGithub("https://github.com/acme/studio", { fetch });
    expect(document).toMatchObject({ kind: "github", name: "acme/studio", source: "https://github.com/acme/studio", truncated: false });
    const text = document.text;
    expect(text).toContain("Description: Booking for yoga studios");
    expect(text).toContain("Languages: TypeScript 90 %, CSS 9 %, Shell 0.5 %");
    expect(text).toContain("License: MIT");
    expect(text).toContain("src/\n  index.ts\n  routes/");
    expect(text).not.toContain("deep.ts");
    expect(text).toContain("## CI workflows (.github/workflows)\n\n- ci.yml");
    expect(text).toContain("## README.md\n\n# Studio\n\nBook classes.");
    expect(text).toContain('## package.json\n\n{ "name": "studio"');
    expect(text).toContain("## Dockerfile\n\nFROM node:22");
    expect(text).toContain("## ARCHITECTURE.md\n\nOne Hono API, one SQLite file.");
    expect(text).toContain("## Architecture decision records (1)\n\n- docs/adr/0001-use-postgres.md");
    expect(text).toContain("## docs/adr/0001-use-postgres.md\n\n# Use PostgreSQL");
    expect(text.indexOf("## README.md")).toBeLessThan(text.indexOf("## package.json"));
    expect(text.indexOf("## Dockerfile")).toBeLessThan(text.indexOf("## ARCHITECTURE.md"));
    const urls = fetch.mock.calls.map((call) => String(call[0]));
    expect(urls.some((url) => url.includes("huge.md"))).toBe(false);
    for (const call of fetch.mock.calls as unknown as [string, RequestInit][]) {
      expect((call[1].headers as Record<string, string>).Authorization).toBeUndefined();
    }
  });

  it("reads files through the API with GITHUB_TOKEN, and sends the token to the API only", async () => {
    const fetch = mockGithub({
      "https://api.github.com/repos/acme/studio/contents/README.md?ref=main": () => new Response("# Private studio"),
    });
    const document = await fetchGithub("https://github.com/acme/studio", { fetch, token: "test-token" });
    expect(document.text).toContain("## README.md\n\n# Private studio");
    for (const call of fetch.mock.calls as unknown as [string, RequestInit][]) {
      expect(call[0].startsWith("https://api.github.com/")).toBe(true);
      expect((call[1].headers as Record<string, string>).Authorization).toBe("Bearer test-token");
    }
  });

  it("imports one folder of a branch whose name has a slash", async () => {
    const fetch = mockGithub({
      "https://api.github.com/repos/acme/studio/git/trees/feature?recursive=1": () => new Response("", { status: 404 }),
      "https://api.github.com/repos/acme/studio/git/trees/feature%2Flogin?recursive=1": () =>
        new Response(JSON.stringify({ truncated: false, tree: [{ path: "apps/api/package.json", type: "blob" }] })),
      "https://raw.githubusercontent.com/acme/studio/feature/login/apps/api/package.json": () => new Response('{ "name": "api" }'),
    });
    const document = await fetchGithub("https://github.com/acme/studio/tree/feature/login/apps/api", { fetch });
    expect(document).toMatchObject({ name: "acme/studio/apps/api", source: "https://github.com/acme/studio/tree/feature/login/apps/api" });
    expect(document.text).toContain("Branch: feature/login, default branch main");
    expect(document.text).toContain('## apps/api/package.json\n\n{ "name": "api" }');
  });

  it("caps a large repository", async () => {
    const many = Array.from({ length: 900 }, (_, i) => ({ path: `src/file${String(i).padStart(3, "0")}.ts`, type: "blob" }));
    const fetch = mockGithub({
      "https://api.github.com/repos/acme/studio/git/trees/main?recursive=1": () =>
        new Response(JSON.stringify({ truncated: true, tree: [{ path: "src", type: "tree" }, ...many] })),
    });
    const document = await fetchGithub("https://github.com/acme/studio", { fetch });
    expect(document.text).toContain("## Files (2 levels, first 300 of 901 entries, the repository is too large to be listed fully)");
    expect(document.text).not.toContain("file300.ts");
  });

  it("maps GitHub errors", async () => {
    const missing = mockGithub({ "https://api.github.com/repos/acme/studio": () => new Response("", { status: 404 }) });
    expect(await codeOf(fetchGithub("https://github.com/acme/studio", { fetch: missing }))).toBe("not_found");
    const limited = mockGithub({
      "https://api.github.com/repos/acme/studio": () => new Response("", { status: 403, headers: { "x-ratelimit-remaining": "0" } }),
    });
    expect(await codeOf(fetchGithub("https://github.com/acme/studio", { fetch: limited }))).toBe("rate_limited");
    const offline = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await codeOf(fetchGithub("https://github.com/acme/studio", { fetch: offline }))).toBe("fetch_failed");
    expect(await codeOf(fetchGithub("https://github.com/acme/studio/tree/nope", { fetch: mockGithub() }))).toBe("not_found");
  });
});
