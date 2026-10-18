import { describe, expect, it } from "vitest";
import { GITHUB_REPO, runCommand } from "./github.ts";

describe("GitHub CLI runner", () => {
  it("passes the body on standard input, untouched by any shell", async () => {
    const body = 'Run `rm -rf /` and $(whoami); "quoted"\n';
    const result = await runCommand(process.execPath, ["-e", "process.stdin.pipe(process.stdout)"], { cwd: process.cwd(), input: body });
    expect(result).toEqual({ code: 0, stdout: body, stderr: "" });
  });

  it("says when the command is not installed", async () => {
    const result = await runCommand("quorumind-no-such-command", ["--version"], { cwd: process.cwd() });
    expect(result.code).toBeNull();
  });

  it("accepts owner/name repositories only", () => {
    expect(GITHUB_REPO.test("octo-org/booking.app")).toBe(true);
    for (const value of ["booking", "a/b/c", "--repo x/y", "-o/r", "o/-r", "o/r;rm", " o/r"])
      expect(GITHUB_REPO.test(value), value).toBe(false);
  });
});
