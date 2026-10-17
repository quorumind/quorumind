import { crc32, deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { readZip } from "./zip.ts";

/** One-entry archive, stored (method 0) or deflated (method 8). */
function archive(name: string, content: string, method: 0 | 8, comment = "") {
  const data = Buffer.from(content);
  const body = method === 8 ? deflateRawSync(data) : data;
  const nameBytes = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(crc32(data), 14);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(crc32(data), 16);
  central.writeUInt32LE(body.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  const offset = local.length + nameBytes.length + body.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + nameBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(comment.length, 20);
  return Buffer.concat([local, nameBytes, body, central, nameBytes, end, Buffer.from(comment)]);
}

describe("readZip", () => {
  it("reads stored and deflated entries, past an archive comment", () => {
    expect(readZip(archive("PLAN.md", "# Plan\n", 0, "made by Quorumind"))).toEqual([{ name: "PLAN.md", data: Buffer.from("# Plan\n") }]);
    expect(readZip(archive("PLAN.md", "# Plan\n".repeat(50), 8))[0]?.data.toString()).toBe("# Plan\n".repeat(50));
  });

  it("rejects what is not a sound archive", () => {
    expect(() => readZip(Buffer.from("not a zip"))).toThrow("Not a ZIP archive");
    const damaged = archive("PLAN.md", "# Plan\n", 0);
    const first = 30 + "PLAN.md".length;
    damaged.writeUInt8(damaged.readUInt8(first) ^ 0xff, first);
    expect(() => readZip(damaged)).toThrow("checksum");
  });
});
