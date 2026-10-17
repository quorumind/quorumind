import { crc32, inflateRawSync } from "node:zlib";

export interface ZipEntry {
  name: string;
  data: Buffer;
}

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_HEADER = 0x02014b50;
const LOCAL_HEADER = 0x04034b50;
const STORED = 0;
const DEFLATED = 8;

/**
 * Reads the files of a ZIP archive. Quorumind writes uncompressed ("stored") entries; deflated
 * entries are read too, since zlib ships with Node. ZIP64, encryption and multi-disk archives
 * are not supported: the hand-off archive never needs them.
 */
export function readZip(archive: Buffer): ZipEntry[] {
  const end = findEndOfCentralDirectory(archive);
  const count = archive.readUInt16LE(end + 10);
  let offset = archive.readUInt32LE(end + 16);
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (offset + 46 > archive.length || archive.readUInt32LE(offset) !== CENTRAL_HEADER) throw new ZipError("Corrupt central directory.");
    const flags = archive.readUInt16LE(offset + 8);
    const method = archive.readUInt16LE(offset + 10);
    const checksum = archive.readUInt32LE(offset + 16);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const size = archive.readUInt32LE(offset + 24);
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const localOffset = archive.readUInt32LE(offset + 42);
    const name = archive.toString(flags & 0x800 ? "utf8" : "latin1", offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;

    if (flags & 0x1) throw new ZipError(`${name} is encrypted.`);
    if (compressedSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) throw new ZipError("ZIP64 is not supported.");
    if (name.endsWith("/")) continue;

    const sound = localOffset + 30 <= archive.length && archive.readUInt32LE(localOffset) === LOCAL_HEADER;
    if (!sound) throw new ZipError(`Corrupt entry ${name}.`);
    const start = localOffset + 30 + archive.readUInt16LE(localOffset + 26) + archive.readUInt16LE(localOffset + 28);
    if (start + compressedSize > archive.length) throw new ZipError(`Truncated entry ${name}.`);
    const raw = archive.subarray(start, start + compressedSize);
    let data: Buffer;
    if (method === STORED) data = Buffer.from(raw);
    else if (method === DEFLATED) data = inflateRawSync(raw);
    else throw new ZipError(`${name} uses an unsupported compression method (${method}).`);
    if (data.length !== size || crc32(data) !== checksum) throw new ZipError(`${name} is damaged (checksum mismatch).`);
    entries.push({ name, data });
  }
  return entries;
}

function findEndOfCentralDirectory(archive: Buffer): number {
  // The record is 22 bytes, followed by a comment of at most 65535 bytes.
  const lowest = Math.max(0, archive.length - 22 - 0xffff);
  for (let offset = archive.length - 22; offset >= lowest; offset--) {
    if (archive.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY) return offset;
  }
  throw new ZipError("Not a ZIP archive.");
}

export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipError";
  }
}
