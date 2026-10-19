import { describe, expect, it, vi } from "vitest";
import { shutdownOnce } from "./shutdown.ts";

describe("the shutdown", () => {
  it("closes the server first, interrupts the work, closes the storage, exits, and runs once", async () => {
    const steps: string[] = [];
    const shutdown = shutdownOnce({
      closeServer: () => steps.push("server"),
      interrupt: async () => steps.push("interrupt"),
      closeStorage: async () => {
        steps.push("storage");
      },
      exit: (code) => steps.push(`exit ${code}`),
    });
    await Promise.all([shutdown(), shutdown()]);
    await shutdown();
    expect(steps).toEqual(["server", "interrupt", "storage", "exit 0"]);
  });

  it("does not wait past its deadline for work that ignores the cancellation", async () => {
    const closeStorage = vi.fn(async () => {});
    const exit = vi.fn();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await shutdownOnce({
        closeServer: () => {},
        interrupt: () => new Promise(() => {}),
        closeStorage,
        exit,
        deadlineMs: 20,
      })();
    } finally {
      error.mockRestore();
    }
    expect(closeStorage).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("still closes the storage and exits when interrupting fails", async () => {
    const exit = vi.fn();
    const closeStorage = vi.fn(async () => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await shutdownOnce({ closeServer: () => {}, interrupt: () => Promise.reject(new Error("boom")), closeStorage, exit })();
    } finally {
      error.mockRestore();
    }
    expect(closeStorage).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(0);
  });
});
