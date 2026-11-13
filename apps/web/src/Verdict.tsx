import type { Audience, Feasibility, Session, TopicStatus } from "@quorumind/core";
import { auditDeliverable } from "@quorumind/core/audit-report";
import { deliveryChecks, proposalCosting } from "@quorumind/core/costing";
import { rankOptions } from "@quorumind/core/ranking";
import { currentProposals, currentRevision, sessionAtRevision } from "@quorumind/core/session";
import { type CSSProperties, type FormEvent, memo, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AuditView, auditHeadline } from "./Audit.tsx";
import { useCanEdit } from "./access.tsx";
import { api, type Feedback, type PriceQuote } from "./api.ts";
import { ClientLoop } from "./ClientLoop.tsx";
import { ArchitectureDiagram } from "./components/ArchitectureDiagram.tsx";
import { BusyButton } from "./components/BusyButton.tsx";
import { ComplianceSection } from "./components/ComplianceOptions.tsx";
import { Segmented } from "./components/Controls.tsx";
import { ExportMenu } from "./components/ExportMenu.tsx";
import { CharCounter, FieldError, fieldProps, useFieldErrors } from "./components/Field.tsx";
import { CheckIcon, CrossIcon, DownloadIcon, MapIcon, SparkIcon, WarningIcon } from "./components/Icons.tsx";
import { ScrollRegion } from "./components/ScrollRegion.tsx";
import { ClaimRefs, SourcesPanel } from "./components/Sources.tsx";
import { CheckBadges, CostingTable, moneyRange, monthlyCurrency } from "./costing.tsx";
import { seatName } from "./Debate.tsx";
import { DecisionPanel } from "./Decisions.tsx";
import { failureText } from "./errors.ts";
import { labelled } from "./format.ts";
import { sendOnShortcut } from "./formKeys.ts";
import { RevisionBar, WhatChanged } from "./Revisions.tsx";
import { ComparePanel, ScenarioForm } from "./Scenarios.tsx";
import { useFlip } from "./useFlip.ts";

export function FeasibilityChip({ value }: { value: Feasibility }) {
  const { t } = useTranslation();
  const icon = value === "feasible" ? <CheckIcon /> : value === "conditional" ? <WarningIcon /> : <CrossIcon />;
  return (
    <span className={`badge feasibility feasibility-${value}`}>
      {icon}
      {t(`feasibility.${value}`)}
    </span>
  );
}

export function Score({ value }: { value: number }) {
  const { t } = useTranslation();
  return (
    <span className="score" role="img" aria-label={t("verdict.scoreOutOf", { score: value })}>
      {[1, 2, 3, 4, 5].map((step) => (
        <i key={step} data-on={step <= value} />
      ))}
      <span className="mono" style={{ marginInlineStart: 6 }}>
        {value}
      </span>
    </span>
  );
}

const AUDIENCES: Audience[] = ["cto", "executive", "client"];
const STATUSES: TopicStatus[] = ["opposed", "divided", "agreement"];
const VOICES: Record<string, string> = { A: "voice-a", B: "voice-b", C: "voice-c", D: "voice-d", U: "voice-you", devil: "voice-devil" };

function Briefs({ session, readOnly }: { session: Session; readOnly: boolean }) {
  const { t } = useTranslation();
  const [audience, setAudience] = useState<Audience | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Writing a new version calls a model: for those who may change the session.
  const canEdit = useCanEdit();
  // The version being written: once it arrives, its title takes the focus (the button pressed is gone).
  const awaited = useRef<Audience | null>(null);
  const headline = useRef<HTMLHeadingElement>(null);
  const arrived = audience !== null && awaited.current === audience && Boolean(session.briefs[audience]);
  useEffect(() => {
    if (!arrived) return;
    awaited.current = null;
    headline.current?.focus();
  }, [arrived]);
  const available = readOnly || !canEdit ? AUDIENCES.filter((value) => session.briefs[value]) : AUDIENCES;
  if (available.length === 0) return null;
  const brief = audience ? session.briefs[audience] : undefined;

  const write = async (value: Audience) => {
    awaited.current = value;
    setPending(true);
    setError(null);
    try {
      await api.brief(session.id, value);
    } catch (caught) {
      setError(failureText(t, caught));
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="stack">
      <div className="row brief-head">
        <h2 className="heading heading-icon">
          <SparkIcon />
          {t("brief.title")}
        </h2>
        <Segmented
          legend={t("brief.title")}
          options={[
            { key: "full", value: null, label: t("brief.full") },
            ...available.map((value) => ({ key: value, value, label: t(`brief.audience.${value}`) })),
          ]}
          value={audience}
          onChange={setAudience}
        />
      </div>
      {audience ? (
        <p className="field-hint brief-scope" style={{ margin: 0 }}>
          {t("brief.scope")}
        </p>
      ) : null}
      {/* The version chosen, said politely: the card under the buttons changed, nothing else on the page did. */}
      <p className="visually-hidden" role="status">
        {audience ? (brief ? t("brief.shown", { audience: t(`brief.audience.${audience}`) }) : "") : ""}
      </p>
      {audience && brief ? (
        <article className="card brief stack" aria-labelledby="brief-headline">
          <h3 className="title" id="brief-headline" ref={headline} tabIndex={-1}>
            {brief.headline}
          </h3>
          <p className="model-text" style={{ margin: 0 }}>
            {brief.summary}
          </p>
          {brief.sections.map((section) => (
            <div key={section.title}>
              <h4>{section.title}</h4>
              <p className="model-text" style={{ margin: 0 }}>
                {section.body}
              </p>
            </div>
          ))}
          {brief.nextSteps.length > 0 ? (
            <div>
              <h4>{t("brief.nextSteps")}</h4>
              <ol style={{ margin: 0 }}>
                {brief.nextSteps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </div>
          ) : null}
        </article>
      ) : audience ? (
        <div className="card stack">
          <p style={{ margin: 0 }}>{t(`brief.describe.${audience}`)}</p>
          {error ? (
            <p className="notice notice-error" role="alert">
              {error}
            </p>
          ) : null}
          <div>
            <BusyButton className="button button-secondary" busy={pending} busyLabel={t("brief.writing")} onClick={() => write(audience)}>
              {t("brief.write")}
            </BusyButton>
          </div>
        </div>
      ) : (
        <p className="field-hint" style={{ margin: 0 }}>
          {t("brief.hint")}
        </p>
      )}
    </section>
  );
}

function Matrix({ session }: { session: Session }) {
  const { t, i18n } = useTranslation();
  const verdict = session.verdict;
  const priorities = session.sheet?.priorities ?? [];
  const initial = Object.fromEntries(priorities.map((priority) => [priority.criterion, priority.weight]));
  const [weights, setWeights] = useState<Record<string, number>>(initial);
  const ranked = verdict ? rankOptions(verdict, weights) : [];
  const body = useFlip<HTMLTableSectionElement>(ranked.map((option) => option.seat).join());
  if (!verdict) return null;
  const proposals = currentProposals(session);
  const checks = deliveryChecks(session);
  const criteria = priorities.map((priority) => priority.criterion);
  const changed = criteria.some((criterion) => weights[criterion] !== initial[criterion]);

  return (
    <section className="stack">
      <div className="row matrix-head">
        <h2 className="heading">{t("verdict.matrix")}</h2>
        {changed ? (
          <button type="button" className="button button-quiet" onClick={() => setWeights(initial)}>
            {t("matrix.reset")}
          </button>
        ) : null}
      </div>
      <p className="field-hint" style={{ margin: 0 }}>
        {t("matrix.hint")}
      </p>
      <div className="weights">
        {criteria.map((criterion, index) => (
          <label className="weight" key={criterion} htmlFor={`weight-${index}`}>
            <span>{criterion}</span>
            <input
              id={`weight-${index}`}
              type="range"
              min={0}
              max={5}
              step={1}
              value={weights[criterion] ?? 0}
              onChange={(event) => setWeights((current) => ({ ...current, [criterion]: Number(event.target.value) }))}
            />
            <span className="mono" aria-hidden="true">
              {weights[criterion] ?? 0}
            </span>
          </label>
        ))}
      </div>
      <ScrollRegion label={t("verdict.matrix")}>
        <table>
          <thead>
            <tr>
              <th scope="col">{t("verdict.option")}</th>
              <th scope="col">{t("matrix.score")}</th>
              <th scope="col">{t("verdict.verdict")}</th>
              {criteria.map((criterion) => (
                <th scope="col" key={criterion} title={criterion}>
                  {criterion}
                </th>
              ))}
              <th scope="col">{t("debate.monthlyCost")}</th>
              <th scope="col">{t("debate.buildCost")}</th>
              <th scope="col">{t("checks.title")}</th>
            </tr>
          </thead>
          <tbody ref={body}>
            {ranked.map((rankedOption, index) => {
              const option = verdict.options.find((item) => item.seat === rankedOption.seat);
              const proposal = proposals[rankedOption.seat];
              if (!option) return null;
              const costing = proposal ? proposalCosting(session, proposal) : null;
              return (
                <tr key={option.seat} data-rank={index + 1} data-flip={option.seat}>
                  <th scope="row" className="option-cell">
                    <span className={VOICES[option.seat] ?? ""}>
                      <span className="voice-name">{option.seat}</span>
                    </span>{" "}
                    {option.title}
                  </th>
                  <td>
                    {rankedOption.score === null ? (
                      "–"
                    ) : (
                      <span className="weighted">
                        <span className="weighted-bar">
                          <i style={{ "--v": rankedOption.score / 5 } as CSSProperties} />
                        </span>
                        <span className="mono">{rankedOption.score.toLocaleString(i18n.language, { maximumFractionDigits: 1 })}</span>
                      </span>
                    )}
                  </td>
                  <td>
                    <div className="stack" style={{ gap: "var(--space-2)" }}>
                      <FeasibilityChip value={option.feasibility} />
                      <span className="field-hint model-text">{option.reason}</span>
                      {option.conditions.length > 0 ? (
                        <span className="field-hint">
                          {labelled(t("verdict.conditions"), option.conditions.join(" · "), i18n.language)}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  {criteria.map((criterion) => {
                    const score = option.scores.find((item) => item.criterion === criterion)?.score;
                    return <td key={criterion}>{score ? <Score value={score} /> : "–"}</td>;
                  })}
                  <td className="mono nowrap">
                    {proposal ? moneyRange(proposal.monthlyCost, monthlyCurrency(session, proposal.monthlyCost), i18n.language) : "–"}
                  </td>
                  <td className="mono nowrap">{costing ? moneyRange(costing.total, costing.currency, i18n.language) : "–"}</td>
                  <td>
                    <CheckBadges checks={checks[option.seat]} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollRegion>
      <p className="field-hint" style={{ margin: 0 }}>
        {t("matrix.estimates")}
      </p>
      {/* The new ranking in one line, rather than the whole table read out again at each move of a slider. */}
      <p className="visually-hidden" role="status">
        {changed && ranked[0]
          ? t("matrix.top", {
              option: `${seatName(ranked[0].seat, t)}, ${verdict.options.find((option) => option.seat === ranked[0]?.seat)?.title ?? ""}`,
            })
          : ""}
      </p>
    </section>
  );
}

/** Each option's costing by work package, in the order of the verdict, with its budget and deadline checks. */
function CostingSection({ session }: { session: Session }) {
  const { t, i18n } = useTranslation();
  const verdict = session.verdict;
  if (!verdict) return null;
  const proposals = currentProposals(session);
  const checks = deliveryChecks(session);
  const costed = verdict.options.flatMap((option) => {
    const proposal = proposals[option.seat];
    const costing = proposal ? proposalCosting(session, proposal) : null;
    return proposal && costing ? [{ seat: option.seat, title: proposal.title, costing }] : [];
  });
  if (costed.length === 0) return null;
  return (
    <section className="stack">
      <h2 className="heading">{t("costing.title")}</h2>
      {costed.map(({ seat, title, costing }) => (
        <article className="card stack" key={seat}>
          <div className="row costing-head">
            <h3 className="title" style={{ margin: 0 }}>
              <span className={VOICES[seat] ?? ""}>
                <span className="voice-name">{seat}</span>
              </span>{" "}
              {title}
            </h3>
            <span className="mono">{moneyRange(costing.total, costing.currency, i18n.language)}</span>
          </div>
          <CheckBadges checks={checks[seat]} />
          <CostingTable costing={costing} caption={`${t("costing.title")}: ${title}`} />
        </article>
      ))}
    </section>
  );
}

function DebateMap({ session }: { session: Session }) {
  const { t } = useTranslation();
  const topics = session.verdict?.topics ?? [];
  if (topics.length === 0) return null;
  const sorted = [...topics].sort((a, b) => STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status));
  return (
    <section className="stack">
      <h2 className="heading heading-icon">
        <MapIcon />
        {t("map.title")}
      </h2>
      <div className="map-legend">
        {STATUSES.map((status) => (
          <span key={status} className={`map-status map-${status}`}>
            {t(`map.${status}`)} · {topics.filter((topic) => topic.status === status).length}
          </span>
        ))}
      </div>
      <div className="map">
        {sorted.map((topic) => (
          <div className={`map-topic map-topic-${topic.status}`} key={topic.topic}>
            <div className="row" style={{ gap: "var(--space-2)" }}>
              <span className={`map-status map-${topic.status}`}>{t(`map.${topic.status}`)}</span>
              <strong>{topic.topic}</strong>
            </div>
            {topic.positions.length > 0 ? (
              <ul className="map-positions">
                {topic.positions.map((item) => (
                  <li key={`${item.seat}-${item.position}`} className={VOICES[item.seat] ?? ""}>
                    {item.seat ? <span className="voice-name">{seatName(item.seat, t)}</span> : null}
                    <span>{item.position}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

function FeedbackBox({ session, feedback }: { session: Session; feedback: Feedback[] }) {
  const { t } = useTranslation();
  const [helpful, setHelpful] = useState<boolean | null>(null);
  const [kind, setKind] = useState<"rating" | "error">("rating");
  const [comment, setComment] = useState("");
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The feedback of the session often arrives after the verdict: whoever already rated it is not asked again.
  const rated = feedback.some((item) => item.kind === "rating");

  const fields = useFieldErrors();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    // An error report with no description tells nobody anything: it says so under the field instead of greying the button.
    if (kind === "error" && !comment.trim()) return fields.report({ comment: t("validation.required") });
    setSending(true);
    setError(null);
    try {
      await api.feedback(session.id, { helpful: kind === "rating" ? helpful : null, kind, comment: comment.trim() });
      setSent(true);
      setComment("");
    } catch (caught) {
      setError(failureText(t, caught));
    } finally {
      setSending(false);
    }
  };

  if ((sent || rated) && kind === "rating") {
    return (
      <section className="card feedback stack">
        <p style={{ margin: 0 }}>{t("feedback.thanks")}</p>
        <div>
          <button
            type="button"
            className="button button-quiet"
            onClick={() => {
              setKind("error");
              setSent(false);
            }}
          >
            {t("feedback.reportError")}
          </button>
        </div>
      </section>
    );
  }
  if (sent) {
    return (
      <section className="card feedback">
        <p style={{ margin: 0 }}>{t("feedback.errorThanks")}</p>
      </section>
    );
  }
  return (
    <form
      ref={fields.form}
      className="card feedback stack"
      onSubmit={submit}
      onKeyDown={(event) => sendOnShortcut(event, sending)}
      noValidate
    >
      {kind === "rating" ? (
        <div className="row">
          <span className="title">{t("feedback.question")}</span>
          <Segmented
            legend={t("feedback.question")}
            options={[
              { key: "yes", value: true as boolean | null, label: t("feedback.yes") },
              { key: "no", value: false, label: t("feedback.no") },
            ]}
            value={helpful}
            onChange={setHelpful}
          />
        </div>
      ) : (
        <span className="title">{t("feedback.errorTitle")}</span>
      )}
      {kind === "error" || helpful !== null ? (
        <div className="field">
          <label className="field-hint" htmlFor="feedback-comment">
            {kind === "error" ? t("feedback.errorLabel") : t("feedback.commentLabel")}
          </label>
          <textarea
            dir="auto"
            id="feedback-comment"
            className="textarea"
            rows={2}
            maxLength={2000}
            value={comment}
            {...fieldProps("feedback-comment", fields.errors.comment, "feedback-comment-counter")}
            onChange={(event) => {
              fields.clear("comment");
              setComment(event.target.value);
            }}
          />
          <FieldError id="feedback-comment" error={fields.errors.comment} />
          <CharCounter id="feedback-comment" value={comment} max={2000} />
        </div>
      ) : null}
      {error ? (
        <p className="notice notice-error" role="alert" style={{ margin: 0 }}>
          {error}
        </p>
      ) : null}
      <div className="row">
        {kind === "error" || helpful !== null ? (
          <BusyButton type="submit" className="button button-secondary" busy={sending} busyLabel={t("common.sending")}>
            {t("feedback.send")}
          </BusyButton>
        ) : null}
        {kind === "rating" ? (
          <button type="button" className="button button-quiet" onClick={() => setKind("error")}>
            {t("feedback.reportError")}
          </button>
        ) : null}
      </div>
    </form>
  );
}

/** The sessions whose verdict has already arrived on this page: coming back to the tab does not play it again. */
const played = new Set<string>();

/** The verdict tab. It changes with the session, never with the text being streamed elsewhere on the page. */
export const Verdict = memo(function Verdict({
  session: live,
  readOnly = false,
  feedback = [],
  reportUrl,
  revisionPrice = null,
  providerCosts = true,
  arrival = false,
}: {
  session: Session;
  readOnly?: boolean;
  /** The ruling has just been rendered while the page was open: it arrives with a motion, once. */
  arrival?: boolean;
  feedback?: Feedback[];
  reportUrl?: string;
  /** What the next revision of the verdict costs, when the host sells revisions. */
  revisionPrice?: PriceQuote | null;
  providerCosts?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const canEdit = useCanEdit();
  // Fixed at the first render: whether this showing plays the entrance. A return to the tab, or a reload, shows it at rest.
  const entering = useRef<boolean | null>(null);
  if (entering.current === null) entering.current = arrival && !played.has(live.id);
  useEffect(() => {
    if (entering.current) played.add(live.id);
  }, [live.id]);
  // The revision on screen: the current one (the adopted scenario, or the latest revision) unless the person picks
  // another one.
  // The pick holds for the current revision it was made on: a new revision, an adoption or its withdrawal makes the
  // new current one shown, instead of keeping the page on the one picked before.
  const [picked, setPicked] = useState<{ number: number; on: number } | null>(null);
  const [client, setClient] = useState<string | null>(null);
  const latest = currentRevision(live)?.number ?? 1;
  const shown = picked && picked.on === latest ? picked.number : latest;
  const session = sessionAtRevision(live, shown) ?? live;
  const verdict = session.verdict;
  if (!verdict) return null;
  const proposals = currentProposals(session);
  // An audit leads with its opinion of the document, then its findings, instead of a comparison of options.
  const audit = session.mode === "audit" ? auditDeliverable(session) : null;
  const headline = audit ? auditHeadline(audit) : null;
  const recommended = verdict.recommendation.seat;
  const recommendedTitle = recommended
    ? recommended === "U"
      ? t("verdict.yourSolution")
      : t("verdict.recommended", { seat: recommended })
    : t("verdict.none");

  return (
    <div className="stack-lg" style={{ marginBlockEnd: "var(--space-12)" }}>
      <RevisionBar
        session={live}
        shown={shown}
        onShow={(number) => setPicked(number === latest ? null : { number, on: latest })}
        canEdit={!readOnly && canEdit}
        providerCosts={providerCosts}
        price={revisionPrice}
      />
      <section className="verdict-panel" {...(entering.current ? { "data-entering": "true" } : {})}>
        <span className="label muted">{t("role.arbiter")}</span>
        <h2 className="display">{headline ? headline.opinion : recommendedTitle}</h2>
        {headline ? (
          <p className="title" style={{ margin: 0 }}>
            {headline.hint}
          </p>
        ) : recommended && proposals[recommended] ? (
          <p className="title" dir="auto" style={{ margin: 0 }}>
            {proposals[recommended].title}
          </p>
        ) : null}
        <p className="model-text" style={{ margin: 0, maxInlineSize: "70ch" }}>
          {verdict.recommendation.rationale}
        </p>
        {session.shortened ? (
          <p className="field-hint" style={{ margin: 0 }}>
            {t("verdict.shortened", { done: session.shortened.rounds, planned: session.rounds, count: session.rounds })}
          </p>
        ) : null}
        <div className="row">
          {readOnly ? (
            // A shared session only offers its Markdown report: the other exports belong to its owner.
            <a className="button button-secondary" href={reportUrl ?? api.reportUrl(session.id)} download>
              <DownloadIcon />
              {t("verdict.download")}
            </a>
          ) : (
            <ExportMenu
              sessionId={session.id}
              hasVerdict
              briefs={(Object.keys(session.briefs ?? {}) as ("cto" | "executive" | "client")[]).sort()}
              revision={shown === latest ? null : shown}
              client={client}
              audit={audit !== null}
            />
          )}
        </div>
      </section>

      <WhatChanged session={live} number={shown} />
      {readOnly ? null : <DecisionPanel session={live} />}

      {audit ? <AuditView audit={audit} /> : null}
      <Briefs session={session} readOnly={readOnly} />
      {/* The weights start again from the priorities of the version shown, a scenario's or a revision's. */}
      {audit ? null : (
        <Matrix
          key={(session.sheet?.priorities ?? []).map((priority) => `${priority.criterion}:${priority.weight}`).join("|")}
          session={session}
        />
      )}
      {audit ? null : <CostingSection session={session} />}
      <ComplianceSection session={session} />
      {!audit && recommended && proposals[recommended]?.components?.length ? (
        <section className="stack">
          <h2 className="heading">{t("verdict.architecture")}</h2>
          <ArchitectureDiagram
            components={proposals[recommended].components}
            flows={proposals[recommended].flows}
            title={proposals[recommended].title}
          />
        </section>
      ) : null}
      <DebateMap session={session} />

      {verdict.risks.length > 0 ? (
        <section className="stack">
          <h2 className="heading">{t("verdict.risks")}</h2>
          <ScrollRegion label={t("verdict.risks")}>
            <table>
              <thead>
                <tr>
                  <th scope="col">{t("verdict.risks")}</th>
                  <th scope="col">{t("verdict.likelihood")}</th>
                  <th scope="col">{t("verdict.impact")}</th>
                  <th scope="col">{t("verdict.mitigation")}</th>
                </tr>
              </thead>
              <tbody>
                {verdict.risks.map((risk) => (
                  <tr key={risk.risk}>
                    <td>{risk.risk}</td>
                    <td>{t(`level.${risk.likelihood}`)}</td>
                    <td>{t(`level.${risk.impact}`)}</td>
                    <td>{risk.mitigation}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        </section>
      ) : null}

      <div className="two-col">
        {verdict.roadmap.length > 0 ? (
          <section className="stack">
            <h2 className="heading">{t("verdict.roadmap")}</h2>
            <ol className="roadmap">
              {verdict.roadmap.map((phase) => (
                <li key={phase.phase}>
                  <div>
                    <strong>{phase.phase}</strong>
                    <div>{phase.content}</div>
                    <div className="field-hint">{labelled(t("verdict.exit"), phase.exitCriterion, i18n.language)}</div>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        ) : null}
        {verdict.claims.length > 0 ? (
          <section className="stack">
            <h2 className="heading">{t("verdict.claims")}</h2>
            {verdict.claims.map((claim) => (
              <div className="claim" key={claim.claim}>
                <span>
                  {claim.claim}
                  <ClaimRefs session={session} ids={claim.sources} />
                </span>
                <span
                  className={`chip ${claim.confidence === "verified" ? "" : claim.confidence === "estimated" ? "severity-major" : "severity-minor"}`}
                >
                  {t(`confidence.${claim.confidence}`)}
                </span>
              </div>
            ))}
            {verdict.openQuestions.length > 0 ? (
              <>
                <h3 className="title">{t("verdict.openQuestions")}</h3>
                <ul style={{ margin: 0 }}>
                  {verdict.openQuestions.map((question) => (
                    <li key={question}>{question}</li>
                  ))}
                </ul>
              </>
            ) : null}
          </section>
        ) : verdict.openQuestions.length > 0 ? (
          // Without key claims, the open questions still need answering: they head a section of their own.
          <section className="stack">
            <h2 className="heading">{t("verdict.openQuestions")}</h2>
            <ul style={{ margin: 0 }}>
              {verdict.openQuestions.map((question) => (
                <li key={question}>{question}</li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>

      <SourcesPanel session={session} />

      {readOnly || !canEdit || shown !== latest ? null : <ClientLoop session={live} price={revisionPrice} onClient={setClient} />}
      {readOnly || !canEdit ? null : (
        <details className="card what-if">
          <summary className="title">{t("scenario.title")}</summary>
          <ScenarioForm session={live} price={revisionPrice} />
        </details>
      )}
      {readOnly || live.revisions.length < 2 ? null : <ComparePanel session={live} />}
      {readOnly ? null : <FeedbackBox session={session} feedback={feedback} />}
    </div>
  );
});
