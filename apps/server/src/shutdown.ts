/** What stopping the server takes, in order. */
export interface ShutdownSteps {
  /** Stops accepting connections, so that no new work starts. */
  closeServer(): void;
  /** Interrupts the work in progress (createApp's interruptAll), ready to be resumed after the restart. */
  interrupt(): Promise<unknown>;
  /** Closes the databases. */
  closeStorage(): Promise<void>;
  exit(code: number): void;
  /** How long the work in progress may take to stop: a provider that ignores the cancellation does not hold the exit. */
  deadlineMs?: number;
}

/**
 * The shutdown of the server, run once whatever the number of signals: the server stops accepting connections, the
 * work in progress is interrupted (within a deadline), then the databases are closed and the process exits.
 */
export function shutdownOnce(steps: ShutdownSteps): () => Promise<void> {
  let stopping: Promise<void> | null = null;
  return () => {
    stopping ??= (async () => {
      try {
        steps.closeServer();
      } catch (error) {
        console.error("Closing the server failed:", error);
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          console.error("The running sessions did not stop in time.");
          resolve();
        }, steps.deadlineMs ?? 20_000);
      });
      await Promise.race([steps.interrupt().catch((error) => console.error("Interrupting the running sessions failed:", error)), deadline]);
      clearTimeout(timer);
      try {
        await steps.closeStorage();
      } catch (error) {
        console.error("Closing the storage failed:", error);
      }
      steps.exit(0);
    })();
    return stopping;
  };
}
