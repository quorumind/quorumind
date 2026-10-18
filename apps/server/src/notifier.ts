import type { Session } from "@quorumind/core";
import { createTransport } from "nodemailer";

type Env = Record<string, string | undefined>;

/** answers_received: the client submitted a questionnaire about the session. */
export type NotifyReason = "complete" | "awaiting_answers" | "failed" | "answers_received";

/** Sends an e-mail when a long debate ends or waits for the person. Optional: needs an SMTP URL. */
export interface Notifier {
  notify(session: Session, reason: NotifyReason, recipient: string | null): Promise<void>;
}

const SUBJECTS: Record<NotifyReason, string> = {
  complete: "Your Quorumind verdict is ready",
  awaiting_answers: "The Quorumind debate needs your answer",
  failed: "Your Quorumind session stopped",
  answers_received: "Your client answered the questionnaire",
};

/** What each notification asks of the person, in e-mails and chat messages. */
export const BODIES: Record<NotifyReason, string> = {
  complete: "The arbiter has ruled. Open the session to read the verdict and download the report.",
  awaiting_answers: "The models need information only you have before they can go on. Answer to resume the debate.",
  failed: "The session stopped on an error. Open it to resume from where it stopped.",
  answers_received: "Open the session to read the answers, then update the recommendation with them.",
};

/**
 * QUORUMIND_SMTP_URL (e.g. smtps://user:password@smtp.example.com:465) and QUORUMIND_MAIL_FROM enable it.
 * QUORUMIND_NOTIFY_EMAIL is the self-hosted default recipient; QUORUMIND_PUBLIC_URL builds the link.
 * Messages are in English for now: they only point back to the interface, which speaks the person's language.
 */
export function notifierFromEnv(env: Env): Notifier | null {
  if (!env.QUORUMIND_SMTP_URL) return null;
  const transport = createTransport(env.QUORUMIND_SMTP_URL);
  const from = env.QUORUMIND_MAIL_FROM ?? "Quorumind <quorumind@localhost>";
  const base = (env.QUORUMIND_PUBLIC_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
  return {
    async notify(session, reason, recipient) {
      const to = recipient ?? env.QUORUMIND_NOTIFY_EMAIL;
      if (!to) return;
      const title = session.sheet?.projectName ?? session.idea.slice(0, 80);
      const link = `${base}/#/s/${session.id}`;
      await transport.sendMail({
        from,
        to,
        subject: `${SUBJECTS[reason]}: ${title}`,
        text: `${BODIES[reason]}\n\n${title}\n${link}\n`,
      });
    },
  };
}
