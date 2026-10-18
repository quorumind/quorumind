// A minimal ZIP writer for the hand-off bundle: a few small text files, stored without compression
// so it needs no dependency. Follows APPNOTE 6.3: local headers, central directory, end record,
// UTF-8 file names (general purpose flag bit 11). No ZIP64: the bundle is far below 4 GB.

export interface ZipEntry {
  path: string;
  content: string | Uint8Array;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** MS-DOS date and time, in local fields as unzip tools expect them. */
function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.min(2107, Math.max(1980, date.getFullYear()));
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

export function zipFiles(files: ZipEntry[], modified: Date = new Date()): Uint8Array {
  const encoder = new TextEncoder();
  const stamp = dosDateTime(modified);
  const entries = files.map((file) => {
    const name = encoder.encode(file.path.replace(/^\/+/, ""));
    const data = typeof file.content === "string" ? encoder.encode(file.content) : file.content;
    return { name, data, crc: crc32(data) };
  });

  const localSize = entries.reduce((sum, entry) => sum + 30 + entry.name.length + entry.data.length, 0);
  const centralSize = entries.reduce((sum, entry) => sum + 46 + entry.name.length, 0);
  const out = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(out.buffer);
  let offset = 0;
  const u16 = (value: number) => {
    view.setUint16(offset, value, true);
    offset += 2;
  };
  const u32 = (value: number) => {
    view.setUint32(offset, value, true);
    offset += 4;
  };
  const bytes = (value: Uint8Array) => {
    out.set(value, offset);
    offset += value.length;
  };

  const offsets: number[] = [];
  for (const entry of entries) {
    offsets.push(offset);
    u32(0x04034b50); // local file header
    u16(20); // version needed: 2.0
    u16(0x0800); // UTF-8 names
    u16(0); // stored
    u16(stamp.time);
    u16(stamp.date);
    u32(entry.crc);
    u32(entry.data.length);
    u32(entry.data.length);
    u16(entry.name.length);
    u16(0); // no extra field
    bytes(entry.name);
    bytes(entry.data);
  }

  const centralStart = offset;
  entries.forEach((entry, index) => {
    u32(0x02014b50); // central directory header
    u16(0x0314); // made by: Unix, spec 2.0
    u16(20);
    u16(0x0800);
    u16(0);
    u16(stamp.time);
    u16(stamp.date);
    u32(entry.crc);
    u32(entry.data.length);
    u32(entry.data.length);
    u16(entry.name.length);
    u16(0); // extra field
    u16(0); // comment
    u16(0); // disk number
    u16(0); // internal attributes
    u32((0o100644 << 16) >>> 0); // external attributes: a regular file, rw-r--r--
    u32(offsets[index] as number);
    bytes(entry.name);
  });

  const centralLength = offset - centralStart;
  u32(0x06054b50); // end of central directory
  u16(0);
  u16(0);
  u16(entries.length);
  u16(entries.length);
  u32(centralLength);
  u32(centralStart);
  u16(0);
  return out;
}
