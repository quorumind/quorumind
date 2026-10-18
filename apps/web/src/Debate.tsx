import type { CritiqueRound, DebateEntry, Probe, Proposal, Revision, Session } from "@quorumind/core";
import { PERSONA_IDS } from "@quorumind/core/templates";
import type { TFunction } from "i18next";
import { type FormEvent, type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { useCanEdit } from "./access.tsx";
import { api } from "./api.ts";
import { ArchitectureDiagram } from "./components/ArchitectureDiagram.tsx";
import { ArrowIcon, DevilIcon, ProbeIcon } from "./components/Icons.tsx";
import { formatMoney } from "./format.ts";
import type { LiveSpeech } from "./useSession.ts";

const VOICES: Record<string, string> = { A: "voice-a", B: "voice-b", C: "voice-c", D: "voice-d", U: "voice-you", devil: "voice-devil" };
const voiceClass = (seat: string | null) => (seat ? (VOICES[seat] ?? "voice-other") : "voice-arbiter");

// Seats of one step in a stable order: proposers, the person's solution, the devil's advocate last.
const SEAT_ORDER = ["A", "B", "C", "D", "U", "devil"];
const seatRank = (seat: string) => {
  const index = SEAT_ORDER.indexOf(seat);
  return index === -1 ? SEAT_ORDER.length : index;
};

export function seatName(seat: string, t: TFunction): string {
  if (seat === "devil") return t("role.devil");
  if (seat === "U") return t("role.yourSolution");
  return t("role.proposer", { seat });
}

export function personaLabel(persona: string | null, personas: readonly string[], t: TFunction): string | null {
  if (!persona) return null;
  return personas.includes(persona) ? t(`persona.${persona}`) : persona;
}

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
  const participant = seat === "devil" ? session.devil : seat ? session.seats[seat] : session.arbiter;
  const persona = personaLabel((participant as { persona?: string | null } | null)?.persona ?? null, PERSONA_IDS, t);
  return (
    <div className={`message ${voiceClass(seat)}`}>
      <div className="message-head">
        <span className="voice-dot" />
        {seat === "devil" ? (
          <span className="voice-icon">
            <DevilIcon />
          </span>
        ) : null}
        <span className="label voice-name">{seat ? seatName(seat, t) : t("role.arbiter")}</span>
        {persona ? <span className="persona-tag">{persona}</span> : null}
        {participant && participant.provider !== "mock" ? <span className="mono muted">{participant.model}</span> : null}
        {typing ? <span className="muted">{t("debate.writing")}</span> : null}
      </div>
      <div className="bubble">
        {typing && speech === "…" ? (
          <span className="typing-dots" role="img" aria-label={t("debate.writing")}>
            <i />
            <i />
            <i />
          </span>
        ) : (
          <p className={`speech${typing ? " typing" : ""}`}>{speech}</p>
        )}
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
        {proposal.buildCost ? (
          <div className="fact">
            <span className="field-hint">{t("debate.buildCost")}</span>
            <span className="mono">
              {formatMoney(proposal.buildCost.low, proposal.buildCost.currency, i18n.language)} –{" "}
              {formatMoney(proposal.buildCost.high, proposal.buildCost.currency, i18n.language)}
            </span>
          </div>
        ) : null}
        <div className="fact">
          <span className="field-hint">{t("debate.buildTime")}</span>
          <span>{proposal.buildTime}</span>
        </div>
      </div>
      <p className="field-hint" style={{ margin: 0 }}>
        {t("debate.estimates")}
      </p>
      <ArchitectureDiagram components={proposal.components} flows={proposal.flows} title={proposal.title} />
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

function ProbeCard({ probe }: { probe: Probe }) {
  const { t } = useTranslation();
  return (
    <div className="message voice-arbiter probe">
      <div className="message-head">
        <span className="voice-dot" />
        <span className="label voice-name">{t("role.arbiter")}</span>
        <span className="chip probe-chip">
          <ProbeIcon />
          {t("debate.probeTag")}
        </span>
      </div>
      <div className="bubble">
        <p className="speech">{probe.speech}</p>
        <p className="probe-angle">{probe.angle}</p>
        <p className="field-hint" style={{ margin: 0 }}>
          {probe.rationale}
        </p>
      </div>
    </div>
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
      return entry.seat === "U" ? t("debate.yourSolution") : t("debate.blind");
    case "probe":
      return t("debate.probe");
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
  const canEdit = useCanEdit();
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
    group.sort((a, b) => ("seat" in a && "seat" in b ? seatRank(a.seat) - seatRank(b.seat) : 0));
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
        if (!answered && session.phase === "awaiting_answers" && canEdit)
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
      case "probe":
        items.push(<ProbeCard key={key} probe={entry.data} />);
        break;
      case "verdict":
        items.push(<Message key={key} session={session} seat={null} speech={entry.data.speech} />);
        break;
    }
  });

  for (const speech of Object.values(live)) {
    if (speech.task === "interview" || speech.task === "brief") continue;
    const round =
      session.debate.filter((entry) => entry.kind === (speech.task === "critique" ? "critiques" : "revision") && entry.seat === speech.seat)
        .length + 1;
    pushDivider(
      speech.task === "proposal"
        ? speech.seat === "U"
          ? t("debate.yourSolution")
          : t("debate.blind")
        : speech.task === "probe"
          ? t("debate.probe")
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
      {items}
    </section>
  );
}
