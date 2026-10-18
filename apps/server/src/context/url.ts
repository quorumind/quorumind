import type { LookupAddress, LookupOptions } from "node:dns";
import { lookup as dnsLookup } from "node:dns/promises";
import http, { type IncomingMessage } from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import type { Readable } from "node:stream";
import zlib from "node:zlib";
import { isPublicAddress } from "./address.ts";
import { ContextError } from "./errors.ts";
import { decodeText, extractFile, MAX_FILE_BYTES } from "./file.ts";
import { htmlToText } from "./html.ts";
import { type ImportedDocument, makeDocument } from "./text.ts";

/** Largest web page read, once decompressed: longer pages are cut, not refused. */
export const MAX_PAGE_BYTES = 3 * 1024 * 1024;
export const FETCH_TIMEOUT_MS = 10_000;
export const MAX_REDIRECTS = 3;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const USER_AGENT = "Quorumind/0.1 (context import)";

export type Resolver = (hostname: string) => Promise<LookupAddress[]>;

export interface FetchOptions {
  /** Lets a self-hoster import pages from the intranet (QUORUMIND_ALLOW_PRIVATE_URLS=1). */
  allowPrivate?: boolean;
  /** DNS resolution; replaced in tests. */
  resolve?: Resolver;
  /** Which resolved addresses may be reached; replaced in tests. */
  isAllowed?: (address: string) => boolean;
  timeoutMs?: number;
}

const systemResolve: Resolver = (hostname) => dnsLookup(hostname, { all: true, verbatim: true });

export function allowPrivateFromEnv(env: Record<string, string | undefined>): boolean {
  return env.QUORUMIND_ALLOW_PRIVATE_URLS === "1" || env.QUORUMIND_ALLOW_PRIVATE_URLS === "true";
}

/** Parses a pasted address; "example.com/page" gets https:// in front. */
export function parseHttpUrl(input: string): URL {
  const trimmed = input.trim();
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    throw new ContextError("unsupported_type", "This is not a valid web address.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ContextError("unsupported_type", "Only http and https addresses can be imported.");
  }
  // Never forward credentials written in the address.
  url.username = "";
  url.password = "";
  url.hash = "";
  return url;
}

/** Resolves a host name and checks every address it points to: one private address is enough to refuse it. */
export async function resolveHost(hostname: string, options: FetchOptions = {}): Promise<LookupAddress[]> {
  const host = hostname.replace(/^\[|\]$/g, "");
  const family = isIP(host);
  let addresses: LookupAddress[];
  if (family) {
    addresses = [{ address: host, family }];
  } else {
    try {
      addresses = await (options.resolve ?? systemResolve)(host);
    } catch {
      throw new ContextError("fetch_failed", `The address ${host} could not be found.`);
    }
    if (addresses.length === 0) throw new ContextError("fetch_failed", `The address ${host} could not be found.`);
  }
  const allowed = options.isAllowed ?? isPublicAddress;
  if (!options.allowPrivate && addresses.some((entry) => !allowed(entry.address))) {
    throw new ContextError("blocked_address", "This address points to a private or local network and cannot be imported.");
  }
  return addresses;
}

type LookupCallback = (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/**
 * A lookup for net.connect that answers with addresses already resolved and checked, without asking
 * DNS again: the connection goes where the check said it may, even if the DNS answer has changed
 * since (DNS rebinding).
 */
export function pinnedLookup(addresses: LookupAddress[]) {
  return (hostname: string, lookupOptions: LookupOptions, callback: LookupCallback) => {
    const wanted = lookupOptions.family === 4 || lookupOptions.family === 6 ? lookupOptions.family : 0;
    const usable = wanted ? addresses.filter((entry) => entry.family === wanted) : addresses;
    const first = usable[0];
    if (!first) {
      callback(Object.assign(new Error(`No IPv${wanted} address for ${hostname}`), { code: "ENOTFOUND" }), "");
      return;
    }
    if (lookupOptions.all) callback(null, usable);
    else callback(null, first.address, first.family);
  };
}

function request(url: URL, addresses: LookupAddress[], signal: AbortSignal): Promise<IncomingMessage> {
  const client = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.request(
      url,
      {
        method: "GET",
        // A fresh connection each time: a pooled socket could lead to another address.
        agent: false,
        lookup: pinnedLookup(addresses),
        signal,
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,application/pdf;q=0.8",
          "Accept-Encoding": "gzip, deflate, br",
        },
      },
      resolve,
    );
    req.on("error", reject);
    req.end();
  });
}

/** Reads the body, decompressed, up to `limit` bytes: beyond it, cuts a page or refuses a file. */
async function readBody(response: IncomingMessage, limit: number, cut: boolean): Promise<Buffer> {
  const encoding = String(response.headers["content-encoding"] ?? "")
    .trim()
    .toLowerCase();
  const decoder =
    encoding === "gzip" || encoding === "x-gzip"
      ? zlib.createGunzip()
      : encoding === "deflate"
        ? zlib.createInflate()
        : encoding === "br"
          ? zlib.createBrotliDecompress()
          : null;
  let source: Readable = response;
  if (decoder) {
    response.on("error", (error) => decoder.destroy(error));
    source = response.pipe(decoder);
  }
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of source as AsyncIterable<Buffer>) {
      size += chunk.length;
      if (size > limit) {
        if (!cut) throw new ContextError("too_large", `The document is larger than ${Math.round(limit / 1024 / 1024)} MB.`);
        chunks.push(chunk.subarray(0, chunk.length - (size - limit)));
        break;
      }
      chunks.push(chunk);
    }
  } finally {
    response.destroy();
    decoder?.destroy();
  }
  return Buffer.concat(chunks);
}

type BodyKind = "html" | "text" | "pdf";

/** Only web pages, plain text and PDF files are imported. A file served without a useful type is accepted if it is a PDF. */
function bodyKind(contentType: string): BodyKind | "sniff" | null {
  const type = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (type === "text/html" || type === "application/xhtml+xml") return "html";
  if (type === "application/pdf") return "pdf";
  if (type === "text/plain" || type === "text/markdown") return "text";
  if (type === "" || type === "application/octet-stream" || type === "binary/octet-stream") return "sniff";
  return null;
}

function charsetOf(contentType: string, body: Buffer, html: boolean): string | null {
  const declared = /charset=["']?([\w.:-]+)/i.exec(contentType)?.[1];
  if (declared) return declared;
  if (!html) return null;
  const head = body.subarray(0, 4096).toString("latin1");
  return /<meta[^>]+charset=["']?([\w.:-]+)/i.exec(head)?.[1] ?? null;
}

function decode(body: Buffer, charset: string | null): string {
  if (charset) {
    try {
      return new TextDecoder(charset).decode(body);
    } catch {
      // Unknown label: fall back to detection.
    }
  }
  return decodeText(body);
}

const lastSegment = (url: URL) => {
  const segment = url.pathname.split("/").filter(Boolean).pop() ?? "";
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

const unsupported = () => new ContextError("unsupported_type", "This address does not lead to a web page, a PDF or a text file.");

/**
 * Fetches a web page (or a PDF or text file on the web) and returns its readable text. Every hop of a
 * redirect is resolved and checked again, and each connection is pinned to the addresses checked.
 */
export async function fetchUrl(input: string, options: FetchOptions = {}): Promise<ImportedDocument> {
  let url = parseHttpUrl(input);
  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    for (let hop = 0; ; hop++) {
      const addresses = await resolveHost(url.hostname, options);
      const response = await request(url, addresses, signal);
      const status = response.statusCode ?? 0;
      const location = response.headers.location;
      if (REDIRECTS.has(status) && location) {
        response.destroy();
        if (hop >= MAX_REDIRECTS) throw new ContextError("fetch_failed", "The page redirects too many times.");
        url = parseHttpUrl(new URL(location, url).href);
        continue;
      }
      if (status < 200 || status >= 300) {
        response.destroy();
        if (status === 404 || status === 410) throw new ContextError("not_found", "This page does not exist (error 404).");
        if (status === 429) throw new ContextError("rate_limited", "The site refuses too many requests. Try again later.");
        throw new ContextError("fetch_failed", `The site answered with error ${status}.`);
      }

      const contentType = String(response.headers["content-type"] ?? "");
      const declared = bodyKind(contentType);
      if (declared === null) {
        response.destroy();
        throw unsupported();
      }
      if (declared !== "html" && declared !== "text" && Number(response.headers["content-length"]) > MAX_FILE_BYTES) {
        response.destroy();
        throw new ContextError("too_large", "The document is larger than 10 MB.");
      }
      const page = declared === "html" || declared === "text";
      const body = await readBody(response, page ? MAX_PAGE_BYTES : MAX_FILE_BYTES, page);
      const kind = declared === "sniff" ? (body.subarray(0, 1024).toString("latin1").includes("%PDF-") ? "pdf" : null) : declared;
      if (kind === null) throw unsupported();

      if (kind === "pdf") {
        const document = await extractFile(lastSegment(url) || `${url.hostname}.pdf`, "application/pdf", body, url.href);
        return { ...document, kind: "url" };
      }
      const text = decode(body, charsetOf(contentType, body, kind === "html"));
      const fallbackName = `${url.hostname}${url.pathname === "/" ? "" : url.pathname}`;
      const { title, text: readable } = kind === "html" ? htmlToText(text) : { title: lastSegment(url), text };
      return makeDocument({
        kind: "url",
        name: title,
        raw: readable,
        source: url.href,
        fallbackName,
        emptyMessage: "No readable text was found on this page. It may be built by scripts: paste its text instead.",
        partial: body.byteLength >= MAX_PAGE_BYTES,
      });
    }
  } catch (error) {
    if (error instanceof ContextError) throw error;
    if (signal.aborted) throw new ContextError("fetch_failed", `The site did not answer within ${Math.round(timeoutMs / 1000)} seconds.`);
    throw new ContextError("fetch_failed", "The site could not be reached.");
  }
}
