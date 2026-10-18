import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { crc32, zipFiles } from "./zip.ts";

const files = [
  { path: "CLAUDE.md", content: "# Instructions\n\nWork phase by phase.\n" },
  { path: "docs/PLAN.md", content: "- [ ] Étape 1 : réservations\n- [ ] 予約\n" },
  { path: "empty.txt", content: "" },
  { path: "bytes.bin", content: new Uint8Array([0, 1, 2, 255]) },
];

/** Reads the archive back through its central directory, as unzip tools do. */
function readZip(archive: Uint8Array) {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const end = archive.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  const size = view.getUint32(end + 12, true);
  let offset = view.getUint32(end + 16, true);
  expect(offset + size).toBe(end);
  const decoder = new TextDecoder();
  const entries: { path: string; data: Uint8Array; crc: number; flags: number }[] = [];
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(offset, true)).toBe(0x02014b50);
    const flags = view.getUint16(offset + 8, true);
    const crc = view.getUint32(offset + 16, true);
    const length = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const local = view.getUint32(offset + 42, true);
    const path = decoder.decode(archive.subarray(offset + 46, offset + 46 + nameLength));
    expect(view.getUint32(local, true)).toBe(0x04034b50);
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    entries.push({ path, data: archive.subarray(start, start + length), crc, flags });
    offset += 46 + nameLength;
  }
  return entries;
}

function hasUnzip() {
  try {
    execFileSync("unzip", ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe("zip writer", () => {
  it("computes the standard CRC-32", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it("writes every file with its UTF-8 name, content and checksum", () => {
    const entries = readZip(zipFiles(files));
    expect(entries.map((entry) => entry.path)).toEqual(files.map((file) => file.path));
    for (const [index, entry] of entries.entries()) {
      const original = files[index]!.content;
      const expected = typeof original === "string" ? new TextEncoder().encode(original) : original;
      expect([...entry.data]).toEqual([...expected]);
      expect(entry.crc).toBe(crc32(expected));
      expect(entry.flags & 0x0800).toBe(0x0800);
    }
  });

  it.runIf(hasUnzip())("passes unzip's integrity test", () => {
    const dir = mkdtempSync(join(tmpdir(), "quorumind-zip-"));
    try {
      const path = join(dir, "bundle.zip");
      writeFileSync(path, zipFiles(files));
      const output = execFileSync("unzip", ["-t", path], { encoding: "utf8" });
      expect(output).toContain("No errors detected");
      expect(execFileSync("unzip", ["-p", path, "docs/PLAN.md"], { encoding: "utf8" })).toBe(files[1]!.content);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
