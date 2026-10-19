import type { Session } from "@quorumind/core";
import { createTransport } from "nodemailer";

type Env = Record<string, string | undefined>;

/**
 * answers_received: the client submitted a questionnaire about the session. review_due: the decision's review date has
 * come. approval_requested: a member asked those who may approve the decision to do so.
 */
export type NotifyReason = "complete" | "awaiting_answers" | "failed" | "answers_received" | "review_due" | "approval_requested";

/** Sends an e-mail when a long debate ends or waits for the person. Optional: needs an SMTP URL. */
export interface Notifier {
  notify(session: Session, reason: NotifyReason, recipient: string | null): Promise<void>;
}

const SUBJECTS: Record<NotifyReason, string> = {
  complete: "Your Quorumind verdict is ready",
  awaiting_answers: "The Quorumind debate needs your answer",
  failed: "Your Quorumind session stopped",
  answers_received: "Your client answered the questionnaire",
  review_due: "A decision is due for review",
  approval_requested: "A decision is waiting for approval",
};

/** What each notification asks of the person, in e-mails and chat messages. */
export const BODIES: Record<NotifyReason, string> = {
  complete: "The arbiter has ruled. Open the session to read the verdict and download the report.",
  awaiting_answers: "The models need information only you have before they can go on. Answer to resume the debate.",
  failed: "The session stopped on an error. Open it to resume from where it stopped.",
  answers_received: "Open the session to read the answers, then update the recommendation with them.",
  review_due:
    "The date set to revisit this decision has come. Open it to check that it still holds: approve it again, update it with what changed, or mark it superseded.",
  approval_requested: "A member of the team asks for this decision to be approved. Open the decision register to approve or reject it.",
};

/** For a review reminder: the condition and the note the team gave the decision, each on its own line. */
function reviewLines(session: Session, reason: NotifyReason): string {
  const decision = reason === "review_due" ? session.decision : null;
  if (!decision) return "";
  return [decision.review.when ? `Revisit if: ${decision.review.when}` : "", decision.note ? `Note: ${decision.note}` : ""]
    .filter(Boolean)
    .map((line) => `${line}\n`)
    .join("");
}

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
        text: `${BODIES[reason]}\n\n${title}\n${reviewLines(session, reason)}${link}\n`,
      });
    },
  };
}
