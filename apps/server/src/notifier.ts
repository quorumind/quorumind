import { DECISION_LABELS, localeInfo, type Session } from "@quorumind/core";
import { createTransport } from "nodemailer";
import { type MailBrand, type MailFact, oneLine, type RenderedMail, renderMail } from "./mail.ts";
import { mailLocale, NOTIFIER_LABELS } from "./mail-labels.ts";

type Env = Record<string, string | undefined>;

/**
 * answers_received: the client submitted a questionnaire about the session. review_due: the decision's review date has
 * come. approval_requested: a member asked those who may approve the decision to do so.
 */
export type NotifyReason = "complete" | "awaiting_answers" | "failed" | "answers_received" | "review_due" | "approval_requested";

/** Someone to notify: their address and, when the host knows it, the language they read (the debate's otherwise). */
export interface NotifyRecipient {
  address: string;
  locale?: string | null;
}

/** Sends an e-mail when a long debate ends or waits for the person. Optional: needs an SMTP URL. */
export interface Notifier {
  /** Without a recipient, the self-hosted server's own address (QUORUMIND_NOTIFY_EMAIL). */
  notify(session: Session, reason: NotifyReason, recipient: string | NotifyRecipient | null): Promise<void>;
}

/** What each notification asks of the person, in chat messages (in English: a channel is shared by the team). */
export const BODIES: Record<NotifyReason, string> = Object.fromEntries(
  Object.entries(NOTIFIER_LABELS.en.messages).map(([reason, labels]) => [reason, labels.body]),
) as Record<NotifyReason, string>;

export interface NotificationOptions {
  /** The address of the session in the interface. */
  link: string;
  brand: MailBrand;
  /** The language of the recipient, when known; the debate's language otherwise. */
  locale?: string | null;
  /** False when the e-mail goes to the server's own address rather than to someone the host named. */
  personal: boolean;
}

/** One notification e-mail, in HTML and plain text. */
export function notificationMail(session: Session, reason: NotifyReason, options: NotificationOptions): RenderedMail {
  const locale = mailLocale(options.locale ?? session.locale);
  const labels = NOTIFIER_LABELS[locale];
  const message = labels.messages[reason];
  const title = oneLine(session.sheet?.projectName ?? session.idea) || "Quorumind";
  // A review reminder recalls the condition and the note the team gave the decision.
  const decision = reason === "review_due" ? session.decision : null;
  const facts: MailFact[] = [];
  if (decision?.review.when) facts.push({ label: DECISION_LABELS[locale].reviewCondition, value: decision.review.when });
  if (decision?.note) facts.push({ label: DECISION_LABELS[locale].note, value: decision.note });
  const why = !options.personal
    ? labels.footerServer
    : reason === "review_due"
      ? labels.footerReview
      : reason === "answers_received" || reason === "approval_requested"
        ? labels.footerAuthor
        : labels.footerNotify;
  return renderMail(
    {
      lang: locale,
      dir: localeInfo(locale).dir,
      subject: message.subject.replace("{title}", oneLine(title, 60)),
      preheader: message.preheader,
      heading: message.heading,
      highlight: title,
      paragraphs: [message.body],
      facts,
      action: { label: message.action, url: options.link },
      linkHint: labels.linkHint,
      footer: [why],
    },
    options.brand,
  );
}

/** What sends the messages: nodemailer's SMTP transport, or a stand-in in tests. */
export interface MailTransport {
  sendMail(message: { from: string; to: string; subject: string; text: string; html: string }): Promise<unknown>;
}

export interface NotifierOptions {
  /** The hosted service's brand (its logo, site and address); a neutral "Quorumind" for a self-hosted server. */
  brand?: Partial<MailBrand>;
  transport?: MailTransport;
}

/**
 * QUORUMIND_SMTP_URL (e.g. smtps://user:password@smtp.example.com:465) and QUORUMIND_MAIL_FROM enable it.
 * QUORUMIND_NOTIFY_EMAIL is the self-hosted default recipient; QUORUMIND_PUBLIC_URL builds the link.
 * Each e-mail is in the recipient's language when the host knows it, in the debate's language otherwise.
 */
export function notifierFromEnv(env: Env, options: NotifierOptions = {}): Notifier | null {
  if (!env.QUORUMIND_SMTP_URL) return null;
  const transport = options.transport ?? createTransport(env.QUORUMIND_SMTP_URL);
  const from = env.QUORUMIND_MAIL_FROM ?? "Quorumind <quorumind@localhost>";
  const base = (env.QUORUMIND_PUBLIC_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
  const brand: MailBrand = { name: "Quorumind", siteUrl: base, ...options.brand };
  return {
    async notify(session, reason, recipient) {
      const named = typeof recipient === "string" ? { address: recipient } : recipient;
      const to = named?.address ?? env.QUORUMIND_NOTIFY_EMAIL;
      if (!to) return;
      const mail = notificationMail(session, reason, {
        link: `${base}/#/s/${session.id}`,
        brand,
        locale: named?.locale ?? null,
        personal: named !== null,
      });
      await transport.sendMail({ from, to, subject: mail.subject, text: mail.text, html: mail.html });
    },
  };
}
