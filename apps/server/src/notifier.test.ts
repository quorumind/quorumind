import { LOCALES, type Session } from "@quorumind/core";
import { createTransport } from "nodemailer";
import { describe, expect, it } from "vitest";
import { escapeHtml, oneLine, renderMail, withColon } from "./mail.ts";
import { mailLocale, NOTIFIER_LABELS } from "./mail-labels.ts";
import { BODIES, type NotifyReason, notificationMail, notifierFromEnv } from "./notifier.ts";

const REASONS: NotifyReason[] = ["complete", "awaiting_answers", "failed", "answers_received", "review_due", "approval_requested"];
const LINK = "https://q.example/#/s/s1";
const BRAND = { name: "Quorumind", siteUrl: "https://q.example" };

function session(locale: string, title = 'Portal <script>alert("x")</script> & "API"'): Session {
  return {
    id: "s1",
    idea: "An idea",
    locale,
    sheet: { projectName: title },
    decision: { review: { when: "volume > 10k <orders>" }, note: "Checked with <b>finance</b>" },
  } as unknown as Session;
}

/** Every text of a set of labels, nested ones included, by its path. */
function texts(value: unknown, path = ""): Record<string, string> {
  if (typeof value === "string") return { [path]: value };
  if (!value || typeof value !== "object") return {};
  return Object.assign({}, ...Object.entries(value).map(([key, item]) => texts(item, path ? `${path}.${key}` : key)));
}

describe("notification e-mails", () => {
  it.each(LOCALES.map((locale) => locale.code))("render every notification in %s, in HTML and in text", (locale) => {
    for (const reason of REASONS) {
      const mail = notificationMail(session(locale), reason, { link: LINK, brand: BRAND, personal: true });
      const labels = NOTIFIER_LABELS[locale].messages[reason];
      expect(mail.subject.length).toBeLessThan(120);
      expect(mail.html).toContain(`<html lang="${locale}" dir="${locale === "ar" ? "rtl" : "ltr"}"`);
      expect(mail.html).toContain(`href="${LINK}"`);
      expect(mail.html).toContain(escapeHtml(labels.action));
      expect(mail.html).toContain(escapeHtml(labels.preheader));
      expect(mail.text).toContain(LINK);
      expect(mail.text).toContain(labels.body);
      // The title someone typed is text, never markup.
      expect(mail.html).not.toContain("<script>");
      expect(mail.html).toContain("Portal &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &quot;API&quot;");
      expect(mail.text).toContain('Portal <script>alert("x")</script> & "API"');
      expect(mail.html).not.toMatch(/src="data:/);
    }
  });

  it("recall the review condition and the note of a decision to review, escaped", () => {
    const mail = notificationMail(session("en"), "review_due", { link: LINK, brand: BRAND, personal: true });
    expect(mail.text).toContain("Review condition: volume > 10k <orders>");
    expect(mail.text).toContain("Note: Checked with <b>finance</b>");
    expect(mail.html).toContain("volume &gt; 10k &lt;orders&gt;");
    expect(mail.html).not.toContain("<b>finance</b>");
    expect(notificationMail(session("en"), "complete", { link: LINK, brand: BRAND, personal: true }).text).not.toContain(
      "Review condition",
    );
  });

  it("speak the recipient's language when the host knows it, the debate's otherwise", () => {
    expect(notificationMail(session("de"), "complete", { link: LINK, brand: BRAND, personal: true }).subject).toMatch(/^Urteil/);
    const french = notificationMail(session("de"), "complete", { link: LINK, brand: BRAND, personal: true, locale: "fr-FR" });
    expect(french.subject).toBe(`Verdict prêt\u00a0: Portal <script>alert("x")</script> & "API"`);
    expect(french.html).toContain('<html lang="fr" dir="ltr"');
  });

  it("say why the person gets it, and name the server's own address when nobody was named", () => {
    const personal = notificationMail(session("en"), "approval_requested", { link: LINK, brand: BRAND, personal: true });
    expect(personal.text).toContain(NOTIFIER_LABELS.en.footerAuthor);
    const server = notificationMail(session("en"), "approval_requested", { link: LINK, brand: BRAND, personal: false });
    expect(server.text).toContain(NOTIFIER_LABELS.en.footerServer);
  });

  it("keep subjects on one line and short", () => {
    const mail = notificationMail(session("en", `A\nvery ${"long ".repeat(40)}title`), "failed", {
      link: LINK,
      brand: BRAND,
      personal: true,
    });
    expect(mail.subject).not.toMatch(/[\r\n]/);
    expect(mail.subject.length).toBeLessThanOrEqual(80);
    expect(mail.subject.endsWith("…")).toBe(true);
  });

  it("keep the chat messages' English bodies", () => {
    expect(BODIES.complete).toBe(NOTIFIER_LABELS.en.messages.complete.body);
  });
});

describe("notification labels", () => {
  const english = texts(NOTIFIER_LABELS.en);

  it.each(LOCALES.map((locale) => locale.code))("%s has every text of English, with the same placeholders", (locale) => {
    const own = texts(NOTIFIER_LABELS[locale]);
    expect(Object.keys(own).sort()).toEqual(Object.keys(english).sort());
    for (const [key, value] of Object.entries(own)) {
      expect(value.trim(), key).not.toBe("");
      expect(value.includes("{title}"), key).toBe(english[key]?.includes("{title}"));
    }
  });

  it("follow French typography: no-break spaces before double punctuation, no exclamation marks", () => {
    for (const [key, value] of Object.entries(texts(NOTIFIER_LABELS.fr))) {
      expect(value, key).not.toMatch(/ [:;?!»]|« /);
      expect(value, key).not.toMatch(/[^\u00a0\u202f][:;?!]/u);
      expect(value, key).not.toContain("!");
    }
  });

  it("map locale tags to the ten languages", () => {
    expect(mailLocale("fr-FR")).toBe("fr");
    expect(mailLocale("pt-BR")).toBe("pt");
    expect(mailLocale("zh")).toBe("zh-Hans");
    expect(mailLocale("zh-CN")).toBe("zh-Hans");
    expect(mailLocale("ar")).toBe("ar");
    expect(mailLocale("auto")).toBe("en");
    expect(mailLocale(null)).toBe("en");
  });
});

describe("mail layout", () => {
  const content = {
    lang: "en",
    dir: "ltr" as const,
    subject: "Subject",
    preheader: "Preview line",
    heading: "Heading",
    paragraphs: ["First <p>"],
    action: { label: "Go", url: "https://q.example/x?a=1&b=2" },
    linkHint: "Copy this link:",
    footer: ["Why you get it."],
  };

  it("escapes addresses in attributes and refuses addresses that are not web ones", () => {
    const mail = renderMail(content, { name: "Quorumind", contact: "hello@quorumind.com", logoUrl: "https://q.example/logo.png" });
    expect(mail.html).toContain('href="https://q.example/x?a=1&amp;b=2"');
    expect(mail.html).toContain('src="https://q.example/logo.png"');
    expect(mail.html).toContain('href="mailto:hello@quorumind.com"');
    expect(mail.html).toContain("First &lt;p&gt;");
    expect(mail.text).toContain("Go:\nhttps://q.example/x?a=1&b=2");
    expect(() => renderMail({ ...content, action: { label: "Go", url: "javascript:alert(1)" } }, { name: "Quorumind" })).toThrow();
  });

  it("puts the preview line first, hidden, and declares both colour schemes", () => {
    const { html } = renderMail(content, { name: "Quorumind" });
    expect(html.indexOf("Preview line")).toBeLessThan(html.indexOf("Heading</h1>"));
    expect(html).toContain('<meta name="color-scheme" content="light dark">');
    expect(html).toContain("prefers-color-scheme: dark");
  });

  it("writes one-line values and colons in the language's way", () => {
    expect(oneLine("a\n\tb\u202ec")).toBe("a b c");
    expect(withColon("fr", "Note")).toBe("Note\u00a0:");
    expect(withColon("ja", "メモ")).toBe("メモ：");
    expect(withColon("en", "Note")).toBe("Note:");
  });
});

describe("notifier", () => {
  it("sends a multipart/alternative message with the HTML and the text", async () => {
    const transport = createTransport({ streamTransport: true, buffer: true });
    const sent: string[] = [];
    const notifier = notifierFromEnv(
      { QUORUMIND_SMTP_URL: "smtp://localhost:2525", QUORUMIND_PUBLIC_URL: "https://q.example/", QUORUMIND_NOTIFY_EMAIL: "me@example.com" },
      {
        transport: {
          sendMail: async (message) => {
            const info = await transport.sendMail(message);
            sent.push(String(info.message));
            return info;
          },
        },
      },
    );
    await notifier?.notify(session("fr"), "complete", null);
    await notifier?.notify(session("en"), "complete", { address: "ada@example.com", locale: "ar" });
    expect(sent).toHaveLength(2);
    expect(sent[0]).toContain("multipart/alternative");
    expect(sent[0]).toContain("text/plain");
    expect(sent[0]).toContain("text/html");
    expect(sent[0]).toContain("To: me@example.com");
    expect(sent[1]).toContain("To: ada@example.com");
    expect(sent[1]).toMatch(/dir=3D"rtl"|dir="rtl"/);
  });

  it("is off without an SMTP address", () => {
    expect(notifierFromEnv({})).toBeNull();
  });
});
