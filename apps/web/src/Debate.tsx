import type { CritiqueRound, DebateEntry, Proposal, Revision, Session } from "@quorumind/core";
import type { TFunction } from "i18next";
import { type FormEvent, type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "./api.ts";
import { ArrowIcon } from "./components/Icons.tsx";
import { formatMoney } from "./format.ts";
import type { LiveSpeech } from "./useSession.ts";

const voiceClass = (seat: string | null) => (seat === "A" ? "voice-a" : seat === "B" ? "voice-b" : seat ? "voice-other" : "voice-arbiter");

function Message({
  session,
  seat,
  speech,
  typing,
  children,
}: {
  session: Session;
  seat: string | null;
  speech: string;
  typing?: boolean;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const participant = seat ? session.seats[seat] : session.arbiter;
  return (
    <div className={`message ${voiceClass(seat)}`}>
      <div className="message-head">
        <span className="voice-dot" />
        <span className="label voice-name">{seat ? t("role.proposer", { seat }) : t("role.arbiter")}</span>
        {participant && participant.provider !== "mock" ? <span className="mono muted">{participant.model}</span> : null}
        {typing ? <span className="muted">{t("debate.writing")}</span> : null}
      </div>
      <div className="bubble">
        <p className={`speech${typing ? " typing" : ""}`}>{speech}</p>
        {children ? (
          <>
            <button
              type="button"
              className="button button-quiet"
              style={{ minBlockSize: 32, paddingInline: 0 }}
              onClick={() => setOpen(!open)}
              aria-expanded={open}
            >
              {open ? t("debate.hideDetails") : t("debate.showDetails")}
            </button>
            {open ? <div className="details">{children}</div> : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

function ProposalDetails({ proposal }: { proposal: Proposal }) {
  const { t, i18n } = useTranslation();
  const money = (amount: number) => formatMoney(amount, proposal.monthlyCost.currency, i18n.language);
  return (
    <>
      <div>
        <div className="title">{proposal.title}</div>
        <p style={{ margin: 0 }}>{proposal.summary}</p>
      </div>
      <div className="facts">
        <div className="fact">
          <span className="field-hint">{t("debate.monthlyCost")}</span>
          <span className="mono">
            {money(proposal.monthlyCost.low)} – {money(proposal.monthlyCost.high)}
          </span>
        </div>
        <div className="fact">
          <span className="field-hint">{t("debate.buildTime")}</span>
          <span>{proposal.buildTime}</span>
        </div>
      </div>
      <div>
        <h4>{t("debate.stack")}</h4>
        <div className="chips">
          {proposal.stack.map((item) => (
            <span className="chip" key={item}>
              {item}
            </span>
          ))}
        </div>
      </div>
      <List title={t("debate.architecture")} items={proposal.architecture} />
      <List title={t("debate.infrastructure")} items={proposal.infrastructure} />
      <List title={t("debate.risks")} items={proposal.risks} />
      <List title={t("debate.assumptions")} items={proposal.assumptions} />
    </>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h4>{title}</h4>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function CritiqueDetails({ round }: { round: CritiqueRound }) {
  const { t } = useTranslation();
  if (round.critiques.length === 0) return <p className="muted">{t("debate.noCritique")}</p>;
  return (
    <div>
      {round.critiques.map((critique) => (
        <div className="critique" key={`${critique.target}-${critique.point}`}>
          <div className="row" style={{ gap: "var(--space-2)" }}>
            <span className={`chip severity-${critique.severity}`}>{t(`severity.${critique.severity}`)}</span>
            <span className="muted">{t("debate.on", { seat: critique.target })}</span>
          </div>
          <strong>{critique.point}</strong>
          <span>{critique.argument}</span>
          <span className="field-hint">{critique.requirement}</span>
        </div>
      ))}
    </div>
  );
}

function RevisionDetails({ revision }: { revision: Revision }) {
  const { t } = useTranslation();
  return (
    <>
      {revision.withdrawn && revision.endorses ? <p className="notice">{t("debate.withdrawn", { seat: revision.endorses })}</p> : null}
      {revision.replies.map((reply) => (
        <div className="critique" key={reply.critique}>
          <span className="chip" style={{ justifySelf: "start" }}>
            {t(`stance.${reply.stance}`)}
          </span>
          <em className="muted">{reply.critique}</em>
          <span>{reply.reply}</span>
        </div>
      ))}
      <ProposalDetails proposal={revision.proposal} />
    </>
  );
}

function QuestionsCard({ session, questions }: { session: Session; questions: string[] }) {
  const { t } = useTranslation();
  const [answers, setAnswers] = useState<string[]>(() => questions.map(() => ""));
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSending(true);
    setError(null);
    try {
      await api.answerDebate(
        session.id,
        questions.map((question, index) => ({ question, answer: answers[index]?.trim() || t("interview.unknown") })),
      );
    } catch {
      setError(t("error.request"));
      setSending(false);
    }
  };

  return (
    <form className="card stack" onSubmit={submit} style={{ borderColor: "var(--thesis)" }}>
      <h3 className="title">{t("debate.questionsTitle")}</h3>
      <p className="muted" style={{ margin: 0 }}>
        {t("debate.questionsLead")}
      </p>
      {questions.map((question, index) => (
        <div className="field" key={question}>
          <label className="field-label" htmlFor={`dq-${index}`}>
            {question}
          </label>
          <textarea
            id={`dq-${index}`}
            className="textarea"
            rows={2}
            maxLength={4000}
            placeholder={t("interview.answerPlaceholder")}
            value={answers[index]}
            onChange={(event) => setAnswers((current) => current.map((value, i) => (i === index ? event.target.value : value)))}
          />
        </div>
      ))}
      {error ? (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      ) : null}
      <div>
        <button type="submit" className="button button-primary" disabled={sending}>
          {t("debate.questionsSend")}
          <ArrowIcon />
        </button>
      </div>
    </form>
  );
}

function dividerFor(entry: DebateEntry, t: TFunction): string | null {
  switch (entry.kind) {
    case "proposal":
      return t("debate.blind");
    case "critiques":
      return t("debate.critiques", { round: entry.round });
    case "revision":
      return t("debate.revisions", { round: entry.round });
    case "verdict":
      return t("debate.verdict");
    default:
      return null;
  }
}

export function Debate({ session, live }: { session: Session; live: LiveSpeech }) {
  const { t } = useTranslation();
  const items: ReactNode[] = [];
  let lastDivider: string | null = null;
  const pushDivider = (label: string | null) => {
    if (label && label !== lastDivider) {
      items.push(
        <div className="phase-divider label" key={`d-${items.length}`}>
          {label}
        </div>,
      );
      lastDivider = label;
    }
  };

  // Proposals, critiques and revisions of one step arrive in parallel; show each step in seat order.
  const ordered: DebateEntry[] = [];
  let group: DebateEntry[] = [];
  const stepOf = (entry: DebateEntry) => ("seat" in entry ? `${entry.kind}:${entry.round}` : null);
  const flush = () => {
    group.sort((a, b) => ("seat" in a && "seat" in b ? a.seat.localeCompare(b.seat) : 0));
    ordered.push(...group);
    group = [];
  };
  for (const entry of session.debate) {
    const step = stepOf(entry);
    if (step === null || (group[0] && stepOf(group[0]) !== step)) flush();
    if (step === null) ordered.push(entry);
    else group.push(entry);
  }
  flush();

  ordered.forEach((entry, index) => {
    pushDivider(dividerFor(entry, t));
    const key = `e-${index}`;
    switch (entry.kind) {
      case "proposal":
        items.push(
          <Message key={key} session={session} seat={entry.seat} speech={entry.data.speech}>
            <ProposalDetails proposal={entry.data} />
          </Message>,
        );
        break;
      case "critiques":
        items.push(
          <Message key={key} session={session} seat={entry.seat} speech={entry.data.speech}>
            <CritiqueDetails round={entry.data} />
          </Message>,
        );
        break;
      case "revision":
        items.push(
          <Message key={key} session={session} seat={entry.seat} speech={entry.data.speech}>
            <RevisionDetails revision={entry.data} />
          </Message>,
        );
        break;
      case "questions": {
        const answered = session.debate.some((other) => other.kind === "answers" && other.round === entry.round);
        if (!answered && session.phase === "awaiting_answers")
          items.push(<QuestionsCard key={key} session={session} questions={entry.questions} />);
        break;
      }
      case "answers":
        items.push(
          <div className="message voice-you" key={key}>
            <div className="message-head">
              <span className="label">{t("debate.yourAnswers")}</span>
            </div>
            <div className="bubble">
              {entry.answers.map((answer) => (
                <p className="speech" key={answer.question}>
                  <span className="muted">{answer.question}</span>
                  <br />
                  {answer.answer}
                </p>
              ))}
            </div>
          </div>,
        );
        break;
      case "verdict":
        items.push(<Message key={key} session={session} seat={null} speech={entry.data.speech} />);
        break;
    }
  });

  for (const speech of Object.values(live)) {
    if (speech.task === "interview") continue;
    const round =
      session.debate.filter((entry) => entry.kind === (speech.task === "critique" ? "critiques" : "revision") && entry.seat === speech.seat)
        .length + 1;
    pushDivider(
      speech.task === "proposal"
        ? t("debate.blind")
        : speech.task === "verdict"
          ? t("debate.verdict")
          : speech.task === "critique"
            ? t("debate.critiques", { round })
            : t("debate.revisions", { round }),
    );
    items.push(
      <Message key={`live-${speech.task}-${speech.seat}`} session={session} seat={speech.seat} speech={speech.text || "…"} typing />,
    );
  }

  return (
    <section className="transcript" aria-label={t("phase.debating")}>
      {session.phase === "complete" ? <h2 className="heading">{t("phase.debating")}</h2> : null}
      {items}
    </section>
  );
}
