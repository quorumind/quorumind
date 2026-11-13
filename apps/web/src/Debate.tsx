import type { CritiqueRound, DebateEntry, Probe, Proposal, Revision, Session } from "@quorumind/core";
import { proposalCosting } from "@quorumind/core/costing";
import { PERSONA_IDS } from "@quorumind/core/templates";
import type { TFunction } from "i18next";
import { type FormEvent, memo, type ReactNode, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { DocumentRead } from "./Audit.tsx";
import { AccessContext, useCanEdit } from "./access.tsx";
import { api } from "./api.ts";
import { ArchitectureDiagram } from "./components/ArchitectureDiagram.tsx";
import { BusyButton } from "./components/BusyButton.tsx";
import { CharCounter } from "./components/Field.tsx";
import { focusTarget } from "./components/focus.ts";
import { ArrowDownIcon, ArrowIcon, DevilIcon, ProbeIcon } from "./components/Icons.tsx";
import { ShortcutHint } from "./components/ShortcutHint.tsx";
import { ResearchCard } from "./components/Sources.tsx";
import { CostingTable, dayRange, moneyRange, monthlyCurrency } from "./costing.tsx";
import { debateWriters, seatName } from "./debateProgress.ts";
import { failureText } from "./errors.ts";
import { sendOnShortcut } from "./formKeys.ts";
import type { LiveSpeech } from "./useSession.ts";

const VOICES: Record<string, string> = { A: "voice-a", B: "voice-b", C: "voice-c", D: "voice-d", U: "voice-you", devil: "voice-devil" };
const voiceClass = (seat: string | null) => (seat ? (VOICES[seat] ?? "voice-other") : "voice-arbiter");

// Seats of one step in a stable order: proposers, the person's solution, the devil's advocate last.
const SEAT_ORDER = ["A", "B", "C", "D", "U", "devil"];
const seatRank = (seat: string) => {
  const index = SEAT_ORDER.indexOf(seat);
  return index === -1 ? SEAT_ORDER.length : index;
};

// The name of a seat lives with the debate's progress (the errors name a seat too); the screens import it from here.
export { seatName };

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
  const speaker = seat ? seatName(seat, t) : t("role.arbiter");
  return (
    <div className={`message ${voiceClass(seat)}`}>
      <div className="message-head">
        <span className="voice-dot" />
        {seat === "devil" ? (
          <span className="voice-icon">
            <DevilIcon />
          </span>
        ) : null}
        <span className="label voice-name">{speaker}</span>
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
              // Every message has this button: its name says whose details it shows, the visible label stays short.
              aria-label={t(open ? "debate.hideDetailsOf" : "debate.showDetailsOf", { name: speaker })}
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

function ProposalDetails({ session, proposal }: { session: Session; proposal: Proposal }) {
  const { t, i18n } = useTranslation();
  const costing = proposalCosting(session, proposal);
  const weeks = proposal.buildWeeks;
  return (
    <>
      <div>
        <div className="title">{proposal.title}</div>
        <p className="model-text" style={{ margin: 0 }}>
          {proposal.summary}
        </p>
      </div>
      <div className="facts">
        <div className="fact">
          <span className="field-hint">{t("debate.monthlyCost")}</span>
          <span className="figure">{moneyRange(proposal.monthlyCost, monthlyCurrency(session, proposal.monthlyCost), i18n.language)}</span>
        </div>
        {costing ? (
          <div className="fact">
            <span className="field-hint">{t("debate.buildCost")}</span>
            <span className="figure">{moneyRange(costing.total, costing.currency, i18n.language)}</span>
            {costing.packages.length > 0 ? (
              <span className="field-hint">{t("debate.personDays", { days: dayRange(costing.days, i18n.language) })}</span>
            ) : null}
          </div>
        ) : null}
        <div className="fact">
          <span className="field-hint">{t("debate.buildTime")}</span>
          <span>{proposal.buildTime}</span>
          {weeks ? <span className="field-hint">{t("debate.weeks", { range: dayRange(weeks, i18n.language) })}</span> : null}
        </div>
      </div>
      <p className="field-hint" style={{ margin: 0 }}>
        {t("debate.estimates")}
      </p>
      {costing && costing.packages.length > 0 ? (
        <div>
          <h4>{t("costing.title")}</h4>
          <CostingTable costing={costing} caption={`${t("costing.title")}: ${proposal.title}`} />
        </div>
      ) : null}
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
          {/* The passage of an audited document the finding is about, checked word for word. */}
          {"quote" in critique && typeof critique.quote === "string" && critique.quote ? (
            <blockquote className="audit-quote-inline" dir="auto">
              {critique.quote}
            </blockquote>
          ) : null}
          <span className="model-text">{critique.argument}</span>
          <span className="field-hint">{critique.requirement}</span>
        </div>
      ))}
    </div>
  );
}

function RevisionDetails({ session, revision }: { session: Session; revision: Revision }) {
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
      <ProposalDetails session={session} proposal={revision.proposal} />
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

/** The id of the form of the debate's questions, and of its heading: the banner of the session leads to them. */
export const QUESTIONS_ID = "debate-questions";

function QuestionsCard({ session, questions }: { session: Session; questions: string[] }) {
  const { t } = useTranslation();
  const [answers, setAnswers] = useState<string[]>(() => questions.map(() => ""));
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unknown = t("interview.unknown");
  const answered = answers.filter((answer) => answer.trim()).length;
  const setAnswer = (index: number, value: string) => setAnswers((current) => current.map((old, i) => (i === index ? value : old)));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSending(true);
    setError(null);
    try {
      await api.answerDebate(
        session.id,
        questions.map((question, index) => ({ question, answer: answers[index]?.trim() || unknown })),
      );
    } catch (caught) {
      setError(failureText(t, caught));
      setSending(false);
    }
  };

  return (
    <form
      id={QUESTIONS_ID}
      className="card stack questions-card"
      onSubmit={submit}
      onKeyDown={(event) => sendOnShortcut(event, sending)}
      aria-labelledby={`${QUESTIONS_ID}-title`}
      style={{ borderColor: "var(--thesis)" }}
    >
      <h3 className="title" id={`${QUESTIONS_ID}-title`} tabIndex={-1} data-focus-target>
        {t("debate.questionsTitle")}
      </h3>
      <p className="muted" style={{ margin: 0 }}>
        {t("debate.questionsLead")}
      </p>
      {questions.map((question, index) => {
        const answer = answers[index] ?? "";
        return (
          <div className="field" key={question}>
            <label className="field-label" htmlFor={`dq-${index}`}>
              {question}
            </label>
            {/* As in the interview: "I don't know" is an answer the person gives, never one sent in their name unseen. */}
            <div className="chips">
              <button
                type="button"
                className="chip chip-unknown"
                aria-pressed={answer.trim() === unknown}
                onClick={() => setAnswer(index, answer.trim() === unknown ? "" : unknown)}
              >
                {unknown}
              </button>
            </div>
            <textarea
              dir="auto"
              id={`dq-${index}`}
              className="textarea"
              rows={2}
              maxLength={4000}
              placeholder={t("interview.answerPlaceholder")}
              aria-describedby={`dq-${index}-counter`}
              value={answer}
              onChange={(event) => setAnswer(index, event.target.value)}
            />
            <CharCounter id={`dq-${index}`} value={answer} max={4000} />
          </div>
        );
      })}
      {error ? (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="row questions-footer">
        <BusyButton type="submit" busy={sending} busyLabel={t("common.sending")}>
          {t("debate.questionsSend")}
          <ArrowIcon />
        </BusyButton>
        <p className="questions-progress">
          {t("interview.progress", { answered, total: questions.length })}
          {answered < questions.length ? ` · ${t("interview.blankHint")}` : null}
        </p>
        <ShortcutHint className="questions-shortcut" />
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

/** The start of a step of the debate: a heading, so that a screen reader can go from round to round. */
function PhaseDivider({ label }: { label: string }) {
  return <h2 className="phase-divider label">{label}</h2>;
}

/** The entries of the debate, each step's parallel arrivals in seat order: proposals, critiques, revisions. */
function orderEntries(debate: DebateEntry[]): DebateEntry[] {
  const ordered: DebateEntry[] = [];
  let group: DebateEntry[] = [];
  const stepOf = (entry: DebateEntry) => ("seat" in entry ? `${entry.kind}:${entry.round}` : null);
  const flush = () => {
    group.sort((a, b) => ("seat" in a && "seat" in b ? seatRank(a.seat) - seatRank(b.seat) : 0));
    ordered.push(...group);
    group = [];
  };
  for (const entry of debate) {
    const step = stepOf(entry);
    if (step === null || (group[0] && stepOf(group[0]) !== step)) flush();
    if (step === null) ordered.push(entry);
    else group.push(entry);
  }
  flush();
  return ordered;
}

/** The label of the last step the transcript shows, after which what is being written follows. */
function lastDivider(session: Session, ordered: DebateEntry[], t: TFunction): string | null {
  for (let index = ordered.length - 1; index >= 0; index--) {
    const label = dividerFor(ordered[index] as DebateEntry, t);
    if (label) return label;
  }
  return session.research ? t("debate.research") : null;
}

/**
 * What was said, as the session records it. It changes with the session, not with each streamed token: the text
 * being written is shown below it, apart.
 */
const Transcript = memo(function Transcript({
  session,
  ordered,
  canAnswer,
  mine,
  searching,
}: {
  session: Session;
  ordered: DebateEntry[];
  canAnswer: boolean;
  mine: boolean;
  searching: boolean;
}) {
  const { t } = useTranslation();
  const items: ReactNode[] = [];
  let lastLabel: string | null = null;
  const pushDivider = (label: string | null) => {
    if (label && label !== lastLabel) {
      items.push(<PhaseDivider key={`d-${items.length}`} label={label} />);
      lastLabel = label;
    }
  };

  // The web research comes first: it runs before the proposals.
  if (session.research) {
    pushDivider(t("debate.research"));
    items.push(<ResearchCard key="research" session={session} searching={searching} />);
  }

  ordered.forEach((entry, index) => {
    pushDivider(dividerFor(entry, t));
    // Keyed by what the entry is, not where it lands: a seat arriving late does not move another's open details.
    const key =
      "seat" in entry
        ? `${entry.kind}-${entry.round}-${entry.seat}`
        : "round" in entry
          ? `${entry.kind}-${entry.round}`
          : `${entry.kind}-${index}`;
    switch (entry.kind) {
      case "proposal":
        items.push(
          <Message key={key} session={session} seat={entry.seat} speech={entry.data.speech}>
            {session.mode === "audit" && entry.seat === "U" && session.audit?.extraction ? (
              <DocumentRead session={session} />
            ) : (
              <ProposalDetails session={session} proposal={entry.data} />
            )}
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
            <RevisionDetails session={session} revision={entry.data} />
          </Message>,
        );
        break;
      case "questions": {
        const answered = session.debate.some((other) => other.kind === "answers" && other.round === entry.round);
        if (!answered && session.phase === "awaiting_answers" && canAnswer)
          items.push(<QuestionsCard key={key} session={session} questions={entry.questions} />);
        break;
      }
      case "answers":
        items.push(
          <div className="message voice-you" key={key} data-answers={entry.round}>
            <div className="message-head">
              <span className="label">{mine ? t("debate.yourAnswers") : t("debate.answers")}</span>
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
  return <>{items}</>;
});

export function Debate({
  session,
  live,
  readOnly = false,
  connected = true,
}: {
  session: Session;
  live: LiveSpeech;
  readOnly?: boolean;
  /** False while the live events are cut: what is being written is stale until they come back. */
  connected?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const canAnswer = useCanEdit() && !readOnly;
  const access = useContext(AccessContext);
  const ordered = useMemo(() => orderEntries(session.debate), [session.debate]);
  const searching = Object.values(live).some((speech) => speech.task === "search");

  const transcript = useRef<HTMLElement>(null);
  const known = useRef<WeakSet<Element> | null>(null);
  // Before the first paint of each commit: what the transcript already held when the tab was shown is marked settled and
  // simply stands there; only an entry added afterwards arrives with its motion (CSS skips [data-settled]).
  useLayoutEffect(() => {
    const root = transcript.current;
    if (!root) return;
    const first = known.current === null;
    const seen = known.current ?? new WeakSet<Element>();
    known.current = seen;
    for (const child of Array.from(root.children)) {
      if (seen.has(child)) continue;
      seen.add(child);
      if (first) child.setAttribute("data-settled", "true");
    }
  });

  // What is being written, after the transcript; a step of its own gets its divider.
  const items: ReactNode[] = [];
  let lastLabel = lastDivider(session, ordered, t);
  for (const speech of Object.values(live)) {
    // A revision of the verdict is followed on the verdict tab, not in the transcript of the debate.
    if (speech.task === "interview" || speech.task === "brief" || speech.task === "reassess" || session.revising) continue;
    // A search has no speech: the research card shows it.
    if (speech.task === "search") continue;
    const round =
      session.debate.filter((entry) => entry.kind === (speech.task === "critique" ? "critiques" : "revision") && entry.seat === speech.seat)
        .length + 1;
    const label =
      speech.task === "proposal"
        ? speech.seat === "U"
          ? t("debate.yourSolution")
          : t("debate.blind")
        : speech.task === "research"
          ? t("debate.research")
          : speech.task === "probe"
            ? t("debate.probe")
            : speech.task === "verdict"
              ? t("debate.verdict")
              : speech.task === "critique"
                ? t("debate.critiques", { round })
                : t("debate.revisions", { round });
    if (label !== lastLabel) {
      items.push(<PhaseDivider key={`live-d-${label}`} label={label} />);
      lastLabel = label;
    }
    items.push(
      <Message key={`live-${speech.task}-${speech.seat}`} session={session} seat={speech.seat} speech={speech.text || "…"} typing />,
    );
  }

  // Who is writing is shown in the session's header and each step is announced there: nothing here speaks by itself.
  return (
    <section ref={transcript} className="transcript" aria-label={t("phase.debating")} data-stale={connected ? undefined : "true"}>
      <Transcript session={session} ordered={ordered} canAnswer={canAnswer} mine={access.mine && !readOnly} searching={searching} />
      {items}
      <NewBelow
        size={ordered.length + items.length}
        following={session.phase === "debating" && connected}
        writers={debateWriters(session, live, t, i18n.language)}
      />
    </section>
  );
}

/**
 * A small pill at the bottom of the screen when something new is written below what the person reads: the page never
 * scrolls by itself while they read, the pill takes them there when they choose.
 */
function NewBelow({ size, following, writers }: { size: number; following: boolean; writers: string }) {
  const { t } = useTranslation();
  const end = useRef<HTMLDivElement>(null);
  // Whether the end of the transcript is on screen (or above it): then nothing new is out of sight.
  const [atEnd, setAtEnd] = useState(true);
  const [seen, setSeen] = useState(size);
  useEffect(() => {
    const node = end.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry) setAtEnd(entry.isIntersecting || entry.boundingClientRect.top < 0);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (atEnd) setSeen(size);
  }, [atEnd, size]);

  const show = following && !atEnd && size > seen;
  const jump = () => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    end.current?.scrollIntoView({ block: "end", behavior: reduce ? "auto" : "smooth" });
    // The keyboard goes where the eyes go: the latest message, not back to the top of the page.
    const messages = end.current?.parentElement?.querySelectorAll<HTMLElement>(":scope > .message");
    const latest = messages?.[messages.length - 1];
    if (latest) focusTarget(latest);
  };
  return (
    <>
      {show ? (
        <button type="button" className="new-below" onClick={jump}>
          <ArrowDownIcon />
          {writers ? t("debate.newBelowWriting", { names: writers }) : t("debate.newBelow")}
        </button>
      ) : null}
      <div ref={end} className="transcript-end" aria-hidden="true" />
    </>
  );
}
