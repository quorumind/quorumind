// Which IP addresses a server-side fetch may reach. Anything that is not plainly on the public internet
// is refused, so that a pasted URL cannot make the server probe its own network (SSRF).

type Range = [bytes: number[], prefix: number];

const IPV4_BLOCKED: Range[] = [
  [[0, 0, 0, 0], 8], // "this" network
  [[10, 0, 0, 0], 8], // private
  [[100, 64, 0, 0], 10], // carrier-grade NAT
  [[127, 0, 0, 0], 8], // loopback
  [[169, 254, 0, 0], 16], // link-local, cloud metadata services
  [[172, 16, 0, 0], 12], // private
  [[192, 0, 0, 0], 24], // IETF protocol assignments
  [[192, 0, 2, 0], 24], // documentation
  [[192, 88, 99, 0], 24], // 6to4 relay anycast
  [[192, 168, 0, 0], 16], // private
  [[198, 18, 0, 0], 15], // benchmarking
  [[198, 51, 100, 0], 24], // documentation
  [[203, 0, 113, 0], 24], // documentation
  [[224, 0, 0, 0], 4], // multicast
  [[240, 0, 0, 0], 4], // reserved, broadcast
];

const IPV6_BLOCKED: Range[] = [
  [[0x20, 0x01, 0x00, 0x00], 23], // Teredo, ORCHID and other IETF assignments (2001::/23)
  [[0x20, 0x01, 0x0d, 0xb8], 32], // documentation
  [[0x3f, 0xff], 20], // documentation (3fff::/20)
];

function inRange(bytes: number[], [base, prefix]: Range): boolean {
  for (let bit = 0; bit < prefix; bit += 8) {
    const width = Math.min(8, prefix - bit);
    const mask = (0xff << (8 - width)) & 0xff;
    if (((bytes[bit / 8] ?? 0) & mask) !== ((base[bit / 8] ?? 0) & mask)) return false;
  }
  return true;
}

export function parseIPv4(ip: string): number[] | null {
  const parts = ip.split(".");
  if (parts.length !== 4 || !parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)) return null;
  return parts.map(Number);
}

/** The 16 bytes of an IPv6 address, or null. Accepts "::", an embedded dotted quad and a zone (%eth0). */
export function parseIPv6(ip: string): number[] | null {
  let text = ip.replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const tail: number[] = [];
  const quad = /(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (quad?.[1]) {
    const v4 = parseIPv4(quad[1]);
    if (!v4) return null;
    tail.push(...v4);
    text = `${text.slice(0, text.length - quad[1].length)}0:0`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const words = (half: string | undefined) => (half ? half.split(":") : []);
  const head = words(halves[0]);
  const rest = words(halves[1]);
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const all = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...rest];
  if (!all.every((word) => /^[\da-f]{1,4}$/i.test(word))) return null;
  const bytes = all.flatMap((word) => {
    const value = Number.parseInt(word, 16);
    return [value >> 8, value & 0xff];
  });
  if (tail.length) bytes.splice(12, 4, ...tail);
  return bytes;
}

function isPublicIPv4(bytes: number[]): boolean {
  return !IPV4_BLOCKED.some((range) => inRange(bytes, range));
}

function isPublicIPv6(bytes: number[]): boolean {
  const zeros = (from: number, to: number) => bytes.slice(from, to).every((byte) => byte === 0);
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d, which covers :: and ::1): judge the IPv4 address.
  if (zeros(0, 10) && ((bytes[10] === 0xff && bytes[11] === 0xff) || (bytes[10] === 0 && bytes[11] === 0))) {
    return isPublicIPv4(bytes.slice(12));
  }
  // IPv4-translated (::ffff:0:a.b.c.d, RFC 2765) reaches the embedded address too.
  if (zeros(0, 8) && bytes[8] === 0xff && bytes[9] === 0xff && zeros(10, 12)) return isPublicIPv4(bytes.slice(12));
  // NAT64 (64:ff9b::/96) reaches the embedded IPv4 address; the local-use prefix (64:ff9b:1::/48) is private.
  if (bytes[0] === 0 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b) {
    return zeros(4, 12) ? isPublicIPv4(bytes.slice(12)) : false;
  }
  // 6to4 (2002::/16) tunnels to the IPv4 address in bytes 2 to 5.
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return isPublicIPv4(bytes.slice(2, 6));
  // Only global unicast (2000::/3) is public: this leaves out ULA (fc00::/7), link-local (fe80::/10),
  // site-local (fec0::/10), multicast (ff00::/8), discard (100::/64) and the unassigned space.
  if (((bytes[0] ?? 0) & 0xe0) !== 0x20) return false;
  return !IPV6_BLOCKED.some((range) => inRange(bytes, range));
}

/** True only for an address on the public internet. Anything unparsable is treated as private. */
export function isPublicAddress(ip: string): boolean {
  const v4 = parseIPv4(ip);
  if (v4) return isPublicIPv4(v4);
  const v6 = parseIPv6(ip);
  return v6 ? isPublicIPv6(v6) : false;
}
