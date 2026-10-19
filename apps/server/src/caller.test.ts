import { createSession, DEMO_LINEUP, DEMO_SCRIPT, firstRevision } from "@quorumind/core";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { EventBus } from "./bus.ts";
import { clientAddress, trustedProxies } from "./caller.ts";
import { SHARE_ATTEMPT_LIMITS } from "./share.ts";
import { SqliteSessionStore } from "./store.ts";

/** What @hono/node-server hands the app: the connection, whose address is the nearest proxy's. */
const connection = (remoteAddress: string) => ({ incoming: { socket: { remoteAddress } } });

describe("the client's address", () => {
  const app = (hops: number) => {
    const server = new Hono();
    server.get("/", (c) => c.text(clientAddress(c, hops)));
    return async (forwarded: string | null) => {
      const headers: Record<string, string> = forwarded === null ? {} : { "X-Forwarded-For": forwarded };
      return (await server.request("/", { headers }, connection("10.0.0.2"))).text();
    };
  };

  it("is the connection's without a trusted proxy, whatever X-Forwarded-For says", async () => {
    expect(await app(0)("203.0.113.9")).toBe("10.0.0.2");
  });

  it("is read from the right of X-Forwarded-For, one entry per trusted proxy", async () => {
    const oneProxy = app(1);
    expect(await oneProxy("203.0.113.9")).toBe("203.0.113.9");
    // A client cannot choose its address by writing one: what it wrote is further left.
    expect(await oneProxy("198.51.100.1, 203.0.113.9")).toBe("203.0.113.9");
    expect(await oneProxy(null)).toBe("10.0.0.2");
    const twoProxies = app(2);
    expect(await twoProxies("198.51.100.1, 203.0.113.9, 10.0.0.1")).toBe("203.0.113.9");
    // Fewer entries than proxies: the farthest one there is.
    expect(await twoProxies("203.0.113.9")).toBe("203.0.113.9");
  });

  it("trusts the number of proxies the host sets, and none otherwise", () => {
    expect(trustedProxies({})).toBe(0);
    expect(trustedProxies({ QUORUMIND_TRUST_PROXY: "2" })).toBe(2);
    expect(trustedProxies({ QUORUMIND_TRUST_PROXY: "yes" })).toBe(0);
    expect(trustedProxies({ QUORUMIND_TRUST_PROXY: "-1" })).toBe(0);
  });
});

describe("the limits behind a reverse proxy", () => {
  async function guesses(env: Record<string, string>) {
    const store = new SqliteSessionStore(":memory:");
    const app = createApp({ store, bus: new EventBus(), env, mockDelayMs: 0 });
    const session = createSession({ locale: "en", idea: "A CRM", demo: true, ...DEMO_LINEUP });
    session.phase = "complete";
    session.verdict = DEMO_SCRIPT.verdict;
    session.revisions = [firstRevision(DEMO_SCRIPT.verdict, session.updatedAt)];
    await store.save(session);
    const share = await app.request(`/api/sessions/${session.id}/share`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "right one" }),
    });
    const { token } = ((await share.json()) as { share: { token: string } }).share;
    const guess = async (client: string) =>
      (
        await app.request(
          `/api/shared/${token}/access`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Forwarded-For": client },
            body: JSON.stringify({ password: "wrong" }),
          },
          connection("10.0.0.2"),
        )
      ).status;
    try {
      for (let i = 0; i < SHARE_ATTEMPT_LIMITS.caller.perWindow; i++) expect(await guess("203.0.113.9")).toBe(401);
      return { same: await guess("203.0.113.9"), other: await guess("198.51.100.7") };
    } finally {
      await store.close();
    }
  }

  it("count each client on its own when the proxy is trusted", async () => {
    expect(await guesses({ QUORUMIND_TRUST_PROXY: "1" })).toEqual({ same: 429, other: 401 });
  });

  it("count every visitor as the proxy otherwise", async () => {
    expect(await guesses({})).toEqual({ same: 429, other: 429 });
  });
});
