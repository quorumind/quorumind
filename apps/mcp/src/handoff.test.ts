import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeHandoffFile } from "./server.ts";

describe("hand-off files", () => {
  let dir = "";
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "quorumind-handoff-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("never replace a file created since the check, unless asked", async () => {
    const path = join(dir, "CLAUDE.md");
    // Written by someone else between the existence check and the write.
    await writeFile(path, "# Mine");
    await expect(writeHandoffFile(path, Buffer.from("# Theirs"), false)).rejects.toMatchObject({ code: "EEXIST" });
    expect(await readFile(path, "utf8")).toBe("# Mine");
  });

  it("replace a file at once when asked, leaving no temporary file", async () => {
    const path = join(dir, "PLAN.md");
    await writeFile(path, "# Old plan");
    await writeHandoffFile(path, Buffer.from("# New plan"), true);
    expect(await readFile(path, "utf8")).toBe("# New plan");
    await writeHandoffFile(join(dir, "AGENTS.md"), Buffer.from("# Agents"), false);
    expect((await readdir(dir)).sort()).toEqual(["AGENTS.md", "PLAN.md"]);
  });
});
