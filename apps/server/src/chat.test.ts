import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSession, DEMO_LINEUP, type Session } from "@quorumind/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.ts";
import { EventBus } from "./bus.ts";
import { type ChatNotifier, chatNotifierFromEnv, chatPayload, createChatNotifier, maskChatWebhook, parseChatWebhook } from "./chat.ts";
import type { Placement } from "./store.ts";
import { SqliteSessionStore } from "./store.ts";

const SLACK = "https://hooks.slack.com/services/T0001/B0002/abcdefSECRET1234";
const TEAMS = "https://contoso.webhook.office.com/webhookb2/aaaa@bbbb/IncomingWebhook/cccc/dddd";
const WORKFLOW =
  "https://prod-12.westeurope.logic.azure.com:443/workflows/0123/triggers/manual/paths/invoke?api-version=2016-06-01&sig=SECRET";

/** A fetch that records what it is sent and answers each call with the given status. */
function recorder(status = 200) {
  const calls: { url: string; init: RequestInit; body: unknown }[] = [];
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {}, body: JSON.parse(String(init?.body ?? "null")) });
    return new Response(status < 300 ? "ok" : "no", { status });
  });
  return { calls, fetch: fetch as unknown as typeof globalThis.fetch };
}

function session(): Session {
  const created = createSession({ locale: "en", idea: "A booking app for yoga studios", demo: true, ...DEMO_LINEUP });
  return { ...created, sheet: null };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("chat webhooks", () => {
  it("accepts Slack incoming webhooks and Teams webhooks and workflows only", () => {
    expect(parseChatWebhook(` ${SLACK} `)).toEqual({ kind: "slack", url: SLACK });
    expect(parseChatWebhook(TEAMS)).toEqual({ kind: "teams", url: TEAMS });
    expect(parseChatWebhook(WORKFLOW)).toMatchObject({ kind: "teams", url: WORKFLOW.replace(":443", "") });
    for (const refused of [
      "http://hooks.slack.com/services/T/B/x",
      "https://hooks.slack.com.evil.example/services/T/B/x",
      "https://evil.example/hooks.slack.com/services/x",
      "https://hooks.slack.com/triggers/T/123",
      "https://user:pass@hooks.slack.com/services/T/B/x",
      "https://hooks.slack.com:8443/services/T/B/x",
      "https://webhook.office.com.evil.example/x",
      "https://evilwebhook.office.com/x",
      "https://contoso.webhook.office.com/",
      "https://127.0.0.1/services/x",
      "hooks.slack.com/services/T/B/x",
      `https://hooks.slack.com/services/${"x".repeat(2_100)}`,
    ]) {
      expect(() => parseChatWebhook(refused), refused).toThrow();
    }
  });

  it("shows only the host and the last characters of a webhook", () => {
    expect(maskChatWebhook(SLACK)).toBe("hooks.slack.com/…1234");
    expect(maskChatWebhook(SLACK)).not.toContain("T0001");
  });

  it("writes a Slack message and a Teams card with the title, the status and the link", () => {
    const message = { title: "Booking <b> & co", reason: "complete" as const, link: "https://quorumind.example/#/s/42" };
    const slack = chatPayload("slack", message) as { text: string; blocks: { text?: { text: string } }[] };
    expect(slack.text).toBe("Quorumind: Verdict ready: Booking &lt;b&gt; &amp; co");
    expect(slack.blocks[0]?.text?.text).toContain("*<https://quorumind.example/#/s/42|Booking &lt;b&gt; &amp; co>*");
    const teams = JSON.stringify(chatPayload("teams", { ...message, reason: "awaiting_answers" }));
    expect(teams).toContain('"contentType":"application/vnd.microsoft.card.adaptive"');
    expect(teams).toContain('"text":"Booking <b> & co"');
    expect(teams).toContain('"value":"Waiting for answers"');
    expect(teams).toContain('"url":"https://quorumind.example/#/s/42"');
  });
});

describe("chat notifier", () => {
  it("posts to every webhook of the session, and only logs a failure, without the address", async () => {
    const ok = recorder();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const placements: (Placement | null)[] = [];
    const notifier = createChatNotifier({
      webhooks: (_session, placement) => {
        placements.push(placement);
        return [parseChatWebhook(SLACK), parseChatWebhook(TEAMS)];
      },
      publicUrl: "https://quorumind.example/",
      fetch: ok.fetch,
    });
    const placement = { owner: "ada", workspace: "w1", private: false };
    const target = session();
    await notifier.notify(target, "failed", placement);
    expect(placements).toEqual([placement]);
    expect(ok.calls.map((call) => call.url)).toEqual([SLACK, TEAMS]);
    expect(ok.calls[0]?.init).toMatchObject({ method: "POST", redirect: "error", headers: { "Content-Type": "application/json" } });
    expect(JSON.stringify(ok.calls[0]?.body)).toContain(`https://quorumind.example/#/s/${target.id}`);
    expect(JSON.stringify(ok.calls[0]?.body)).toContain("A booking app for yoga studios");
    expect(errors).not.toHaveBeenCalled();

    const down = recorder(500);
    const failing = createChatNotifier({ webhooks: () => [parseChatWebhook(SLACK)], publicUrl: "https://q.example", fetch: down.fetch });
    await expect(failing.notify(target, "complete", null)).resolves.toBeUndefined();
    const thrown = createChatNotifier({
      webhooks: () => [parseChatWebhook(SLACK)],
      publicUrl: "https://q.example",
      fetch: (async () => {
        throw new TypeError("fetch failed");
      }) as typeof globalThis.fetch,
    });
    await expect(thrown.notify(target, "complete", null)).resolves.toBeUndefined();
    const logged = errors.mock.calls.map((call) => String(call[0])).join("\n");
    expect(logged).toContain("HTTP 500");
    expect(logged).toContain("fetch failed");
    expect(logged).not.toContain("SECRET");
  });

  it("reads the self-hosted webhooks from the environment, or a file", async () => {
    expect(chatNotifierFromEnv({})).toBeNull();
    expect(() => chatNotifierFromEnv({ QUORUMIND_SLACK_WEBHOOK_URL: "https://example.com/hook" })).toThrow("QUORUMIND_SLACK_WEBHOOK_URL");
    expect(() => chatNotifierFromEnv({ QUORUMIND_SLACK_WEBHOOK_URL: TEAMS })).toThrow("is not a Slack webhook");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(chatNotifierFromEnv({ QUORUMIND_SLACK_WEBHOOK_URL: SLACK, QUORUMIND_LOCAL_ONLY: "1" })).toBeNull();

    const dir = mkdtempSync(join(tmpdir(), "quorumind-chat-"));
    try {
      writeFileSync(join(dir, "teams"), `${TEAMS}\n`);
      const sent = recorder();
      const notifier = chatNotifierFromEnv(
        {
          QUORUMIND_SLACK_WEBHOOK_URL: SLACK,
          QUORUMIND_TEAMS_WEBHOOK_URL_FILE: join(dir, "teams"),
          QUORUMIND_PUBLIC_URL: "https://q.example",
        },
        sent.fetch,
      );
      await notifier?.notify(session(), "complete", null);
      expect(sent.calls.map((call) => call.url)).toEqual([SLACK, TEAMS]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("chat notifications of the app", () => {
  it("notifies when the debate waits for answers and when the verdict is ready, without the e-mail opt-in", async () => {
    const store = new SqliteSessionStore(":memory:");
    const events: { reason: string; placement: Placement | null }[] = [];
    const chat: ChatNotifier = {
      notify: async (_session, reason, placement) => {
        events.push({
          reason,
          placement: placement && { owner: placement.owner, workspace: placement.workspace, private: placement.private },
        });
      },
    };
    try {
      const app = createApp({ store, bus: new EventBus(), env: {}, mockDelayMs: 0, chat });
      const send = (method: string, body: unknown) => ({
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const wait = async (id: string, done: (s: Session, busy: boolean) => boolean) => {
        for (let i = 0; i < 300; i++) {
          const { session: s, busy } = (await (await app.request(`/api/sessions/${id}`)).json()) as { session: Session; busy: boolean };
          if (done(s, busy)) return s;
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        throw new Error("Timed out");
      };
      const { session: created } = (await (await app.request("/api/sessions", send("POST", { locale: "en", demo: true }))).json()) as {
        session: Session;
      };
      await wait(created.id, (s, busy) => s.interview.length === 1 && !busy);
      await app.request(`/api/sessions/${created.id}/interview`, send("POST", { answers: [{ question: "Budget?", answer: "€15,000" }] }));
      const review = await wait(created.id, (s, busy) => s.phase === "review" && !busy);
      await app.request(`/api/sessions/${created.id}/sheet`, send("PUT", { sheet: review.sheet }));
      await wait(created.id, (s, busy) => s.phase === "awaiting_answers" && !busy);
      await app.request(`/api/sessions/${created.id}/answers`, send("POST", { answers: [{ question: "Hosted?", answer: "Yes" }] }));
      await wait(created.id, (s, busy) => s.phase === "complete" && !busy);
      await vi.waitFor(() => expect(events.map((event) => event.reason)).toEqual(["awaiting_answers", "complete"]));
      expect(events[0]?.placement).toEqual({ owner: null, workspace: null, private: false });
    } finally {
      await store.close();
    }
  });
});
