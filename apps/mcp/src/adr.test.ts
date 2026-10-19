import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AdrError, adrFileName, adrSlug, findAdrTarget, writeAdr } from "./adr.ts";

describe("ADR folder", () => {
  let root = "";
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "quorumind-adr-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const touch = async (path: string, content = "# ADR\n") => {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), content);
  };

  it("starts docs/adr at 0001 when the repository has no ADR yet", async () => {
    const target = await findAdrTarget(root);
    expect(target).toMatchObject({ relativeDirectory: "docs/adr", exists: false, count: 0, number: 1, width: 4 });
    const path = await writeAdr(target, "authentication", "# 1. Authentication\n");
    expect(path).toBe(join(root, "docs", "adr", "0001-authentication.md"));
    expect(await readFile(path, "utf8")).toBe("# 1. Authentication\n");
  });

  it("numbers after the highest record, with the same number of digits", async () => {
    await touch("docs/decisions/0001-record-architecture-decisions.md");
    await touch("docs/decisions/0006-use-postgresql.md");
    await touch("docs/decisions/README.md");
    await touch("docs/decisions/template.md");
    expect(await findAdrTarget(root)).toMatchObject({ relativeDirectory: "docs/decisions", count: 2, number: 7, width: 4 });

    await rm(join(root, "docs"), { recursive: true });
    await touch("adr/001-first.md");
    await touch("adr/012-twelfth.md");
    const target = await findAdrTarget(root);
    expect(target).toMatchObject({ relativeDirectory: "adr", number: 13, width: 3 });
    expect(adrFileName(target.number, target.width, "cache")).toBe("013-cache.md");
  });

  it("prefers the first usual folder, unless a later one holds more records", async () => {
    await mkdir(join(root, "docs", "adr"), { recursive: true });
    await touch("doc/adr/0001-a.md");
    expect((await findAdrTarget(root)).relativeDirectory).toBe("doc/adr");
    await touch("docs/adr/0001-a.md");
    expect((await findAdrTarget(root)).relativeDirectory).toBe("docs/adr");
  });

  it("follows adr-tools' .adr-dir, inside the repository only", async () => {
    await writeFile(join(root, ".adr-dir"), "architecture/records\n");
    await touch("docs/adr/0009-ignored.md");
    expect(await findAdrTarget(root)).toMatchObject({ relativeDirectory: "architecture/records", exists: false, number: 1 });
    await writeFile(join(root, ".adr-dir"), "../elsewhere\n");
    await expect(findAdrTarget(root)).rejects.toThrow(AdrError);
  });

  it("never replaces a file", async () => {
    await touch("docs/adr/0002-mine.md", "mine");
    const target = { ...(await findAdrTarget(root)), number: 2 };
    await expect(writeAdr(target, "mine", "theirs")).rejects.toThrow("Nothing was written");
    expect(await readFile(join(root, "docs", "adr", "0002-mine.md"), "utf8")).toBe("mine");
  });

  it("never takes a number another record took meanwhile", async () => {
    const target = await findAdrTarget(root);
    // Another agent records ADR 1 between the lookup and the write.
    await touch("docs/adr/0001-their-decision.md", "theirs");
    await expect(writeAdr(target, "mine", "mine")).rejects.toThrow("ADR 1 was just recorded");
    expect(await readdir(join(root, "docs", "adr"))).toEqual(["0001-their-decision.md"]);
  });

  it("refuses an ADR folder that leads outside the repository through a link", async () => {
    const outside = await mkdtemp(join(tmpdir(), "quorumind-outside-"));
    try {
      await mkdir(join(root, "docs"), { recursive: true });
      await symlink(outside, join(root, "docs", "adr"), "junction");
      await expect(findAdrTarget(root)).rejects.toThrow("outside the repository");
      await writeFile(join(root, ".adr-dir"), "docs/adr\n");
      await expect(findAdrTarget(root)).rejects.toThrow("outside the repository");
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("slugs titles in any script to a safe file name", () => {
    expect(adrSlug("Authentification & sessions")).toBe("authentification-sessions");
    expect(adrSlug("認証")).toBe("decision");
    expect(adrSlug("../../etc/passwd")).toBe("etc-passwd");
  });
});
