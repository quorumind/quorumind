import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_CONTEXT_CHARS, MAX_CONTEXT_DOCUMENTS } from "@quorumind/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../server/src/app.ts";
import { EventBus } from "../../server/src/bus.ts";
import { SqliteSessionStore } from "../../server/src/store.ts";
import { MAX_FILE_CHARS, MAX_FILES, readContextFiles } from "./files.ts";

describe("context files", () => {
  let workdir = "";
  beforeAll(async () => {
    workdir = await mkdtemp(join(tmpdir(), "quorumind-files-"));
  });
  afterAll(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  it("uses the server's limits", () => {
    expect(MAX_FILES).toBe(MAX_CONTEXT_DOCUMENTS);
    expect(MAX_FILE_CHARS).toBe(MAX_CONTEXT_CHARS);
  });

  it("refuses more files than a session can carry", async () => {
    const paths = Array.from({ length: MAX_FILES + 1 }, (_, i) => `notes-${i}.md`);
    await expect(readContextFiles(paths, workdir)).rejects.toThrow(`Attach at most ${MAX_FILES} files.`);
  });

  it("cuts long files so that the server accepts the largest set", async () => {
    const paths: string[] = [];
    for (let i = 0; i < MAX_FILES; i++) {
      paths.push(`spec-${i}.md`);
      await writeFile(join(workdir, `spec-${i}.md`), `# Spec ${i}\n${"détail ".repeat(30_000)}`);
    }
    const { documents, notes } = await readContextFiles(paths, workdir);
    expect(notes).toHaveLength(MAX_FILES);
    for (const document of documents) {
      expect(document.text.length).toBeLessThanOrEqual(MAX_FILE_CHARS);
      expect(document).toMatchObject({ kind: "file", truncated: true });
    }

    const store = new SqliteSessionStore(":memory:");
    try {
      const app = createApp({ store, bus: new EventBus(), env: {}, mockDelayMs: 0 });
      const response = await app.request("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: "en", demo: true, context: documents }),
      });
      expect(response.status).toBe(201);
    } finally {
      await store.close();
    }
  });
});
