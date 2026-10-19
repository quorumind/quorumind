import { readFileSync } from "node:fs";
import { type FetchLike, isLocalOnly, type Session } from "@quorumind/core";
import { BODIES, type NotifyReason } from "./notifier.ts";
import type { Placement } from "./store.ts";

type Env = Record<string, string | undefined>;

// Chat notifications: a message in a Slack or Microsoft Teams channel, through an incoming webhook, when a
// session waits for answers, finishes or fails. The webhook URL is a secret (whoever has it can post in the
// channel): it is never logged, and only its host and last characters are ever shown.

export type ChatKind = "slack" | "teams";

export interface ChatWebhook {
  kind: ChatKind;
  url: string;
}

export class ChatWebhookError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatWebhookError";
  }
}

export const CHAT_WEBHOOK_MAX = 2_048;

/**
 * A Slack incoming webhook (https://hooks.slack.com/services/...) or a Microsoft Teams one: an Office 365
 * connector on *.webhook.office.com, or a Teams workflow on *.logic.azure.com. Anything else is refused, so a
 * webhook setting can never make the server call another address.
 */
export function parseChatWebhook(raw: string): ChatWebhook {
  const value = raw.trim();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ChatWebhookError("The webhook must be a full https:// address.");
  }
  if (value.length > CHAT_WEBHOOK_MAX) throw new ChatWebhookError("The webhook address is too long.");
  if (url.protocol !== "https:") throw new ChatWebhookError("The webhook must be an https:// address.");
  if (url.username || url.password || url.port)
    throw new ChatWebhookError("The webhook address must not carry a user name, a password or a port.");
  const host = url.hostname.toLowerCase();
  if (host === "hooks.slack.com") {
    if (!url.pathname.startsWith("/services/")) {
      throw new ChatWebhookError("A Slack webhook is an incoming webhook address: https://hooks.slack.com/services/...");
    }
    return { kind: "slack", url: url.href };
  }
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)*\.(webhook\.office\.com|logic\.azure\.com)$/.test(host) && url.pathname.length > 1) {
    return { kind: "teams", url: url.href };
  }
  throw new ChatWebhookError(
    "Only Slack incoming webhooks (hooks.slack.com) and Microsoft Teams webhooks (*.webhook.office.com, or *.logic.azure.com for Teams workflows) are accepted.",
  );
}

/** What can be shown of a webhook: its host and its last four characters. */
export function maskChatWebhook(url: string): string {
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    // Not a URL: show nothing of it but its end.
  }
  return `${host}/…${url.slice(-4)}`;
}

const STATUS: Record<NotifyReason, string> = {
  complete: "Verdict ready",
  awaiting_answers: "Waiting for answers",
  failed: "Stopped on an error",
  answers_received: "Client answered",
  review_due: "Decision due for review",
  approval_requested: "Approval requested",
};

export interface ChatMessage {
  title: string;
  reason: NotifyReason;
  link: string;
}

const slackText = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** The request body of a webhook: Slack blocks, or a Teams message with an Adaptive Card. */
export function chatPayload(kind: ChatKind, message: ChatMessage): unknown {
  const status = STATUS[message.reason];
  const body = BODIES[message.reason];
  if (kind === "slack") {
    return {
      text: `Quorumind: ${status}: ${slackText(message.title)}`,
      blocks: [
        { type: "section", text: { type: "mrkdwn", text: `*<${message.link}|${slackText(message.title)}>*\n${slackText(body)}` } },
        { type: "context", elements: [{ type: "mrkdwn", text: `Quorumind · *${status}*` }] },
      ],
    };
  }
  return {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        contentUrl: null,
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.4",
          body: [
            { type: "TextBlock", text: message.title, weight: "Bolder", size: "Medium", wrap: true },
            { type: "FactSet", facts: [{ title: "Status", value: status }] },
            { type: "TextBlock", text: body, wrap: true },
          ],
          actions: [{ type: "Action.OpenUrl", title: "Open the session", url: message.link }],
        },
      },
    ],
  };
}

/** Sends a session's chat notifications. Never throws: a channel that is down must not fail the session. */
export interface ChatNotifier {
  notify(session: Session, reason: NotifyReason, placement: Placement | null): Promise<void>;
}

export interface ChatNotifierOptions {
  /** The webhooks a session notifies: every session's on a self-hosted server, its workspace's on the hosted one. */
  webhooks(session: Session, placement: Placement | null): ChatWebhook[] | Promise<ChatWebhook[]>;
  /** The address of the interface, for the link to the session. */
  publicUrl: string;
  fetch?: FetchLike;
  timeoutMs?: number;
}

export function createChatNotifier(options: ChatNotifierOptions): ChatNotifier {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const base = options.publicUrl.replace(/\/+$/, "");
  return {
    async notify(session, reason, placement) {
      let webhooks: ChatWebhook[];
      try {
        webhooks = await options.webhooks(session, placement);
      } catch (error) {
        console.error(`Chat notification of session ${session.id} skipped: ${(error as Error).message}`);
        return;
      }
      const message = { title: session.sheet?.projectName ?? session.idea.slice(0, 80), reason, link: `${base}/#/s/${session.id}` };
      await Promise.all(
        webhooks.map(async (webhook) => {
          try {
            const response = await fetchImpl(webhook.url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(chatPayload(webhook.kind, message)),
              redirect: "error",
              signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
          } catch (error) {
            // The address is a secret: the log names its host only.
            console.error(
              `Chat notification of session ${session.id} to ${maskChatWebhook(webhook.url)} failed: ${(error as Error).message}`,
            );
          }
        }),
      );
    },
  };
}

/** NAME, or the content of the file NAME_FILE points to (a Docker secret). */
function setting(env: Env, name: string): string | null {
  const direct = env[name]?.trim();
  if (direct) return direct;
  const path = env[`${name}_FILE`]?.trim();
  if (!path) return null;
  try {
    return readFileSync(path, "utf8").trim() || null;
  } catch (error) {
    throw new Error(`${name}_FILE points to ${path}, which cannot be read (${(error as Error).message}).`);
  }
}

/**
 * The self-hosted chat notifications: QUORUMIND_SLACK_WEBHOOK_URL and QUORUMIND_TEAMS_WEBHOOK_URL (or their
 * _FILE variants), each optional, notify every session. QUORUMIND_PUBLIC_URL builds the link. Off in local-only
 * mode, which promises that nothing leaves the machine.
 */
export function chatNotifierFromEnv(env: Env, fetch?: FetchLike): ChatNotifier | null {
  const webhooks: ChatWebhook[] = [];
  for (const [name, kind] of [
    ["QUORUMIND_SLACK_WEBHOOK_URL", "slack"],
    ["QUORUMIND_TEAMS_WEBHOOK_URL", "teams"],
  ] as const) {
    const value = setting(env, name);
    if (!value) continue;
    let webhook: ChatWebhook;
    try {
      webhook = parseChatWebhook(value);
    } catch (error) {
      throw new Error(`${name}: ${(error as Error).message}`);
    }
    if (webhook.kind !== kind) throw new Error(`${name} is not a ${kind === "slack" ? "Slack" : "Microsoft Teams"} webhook.`);
    webhooks.push(webhook);
  }
  if (webhooks.length === 0) return null;
  if (isLocalOnly(env)) {
    console.warn("Chat notifications are off: QUORUMIND_LOCAL_ONLY keeps every session on this machine.");
    return null;
  }
  return createChatNotifier({
    webhooks: () => webhooks,
    publicUrl: env.QUORUMIND_PUBLIC_URL ?? "http://127.0.0.1:8787",
    ...(fetch ? { fetch } : {}),
  });
}
