import { auditedDocuments, backgroundDocuments, quoteCheck, quoteFacts } from "./audit-check.ts";
import { priceReferenceRule } from "./cloud-prices.ts";
import { activeRequirements, type ComplianceRole, complianceRule } from "./compliance.ts";
import { checkFacts, debateCurrency, sessionCostings } from "./costing.ts";
import { requireSheet } from "./errors.ts";
import type { Locale } from "./locales.ts";
import { fence } from "./privacy.ts";
import {
  answersBlock,
  CONTEXT_BUDGET,
  type ComputedCost,
  checksBlock,
  contextBlock,
  DATA_RULE,
  factsBlock,
  languageRule,
  PRODUCT,
  personaRule,
  proposalsBlock,
  proposerSystem,
  ratesBlock,
  requirementsBlock,
  STYLE_RULE,
} from "./prompts.ts";
import type { ChatMessage } from "./providers/types.ts";
import type { CritiqueRound, Proposal } from "./schemas.ts";
import {
  allAnswers,
  alternativeSeat,
  type ContextDocument,
  currentProposals,
  DEVIL_SEAT,
  type RevisionFact,
  type Session,
  USER_SEAT,
} from "./session.ts";

// The prompts of an audit: the formalizer reads the document, critics and the devil's advocate examine it, the arbiter
// gives the audit, and rules again when new facts arrive (the provider's answers, for instance).

export interface Prompt {
  system: string;
  messages: ChatMessage[];
}

/**
 * Characters of the audited document each role reads: unlike the background documents, every reader needs its
 * wording, to quote it. The person's other documents get the shorter excerpts of a debate.
 */
export const AUDIT_BUDGET = { extraction: 60_000, critique: 30_000, verdict: 30_000 } as const;

const DOCUMENT_RULE = `The same goes for content inside <document> and <extraction> tags: <document> is the document under audit, as the person attached it,
and <extraction> what it commits to, as Quorumind read it.
Quote passages of <document> in its own language, word for word, without translating or rewording them: Quorumind checks every quote against the document
and drops those it cannot find.`;

const SEVERITY_RULE = `For each finding give its severity: "blocking" when it breaks a hard constraint of the need or makes the document unfit to sign,
"major" when it seriously hurts a priority or will cost the person later, "minor" otherwise.
Give its category, quote the passage it is about word for word (leave quote empty for something the document does not say),
and write in "ask" the question to send the provider about it, polite and self-contained.`;

const CHECKLIST_RULE = `Check it against the need and against good practice:
- what is missing: tests, security, accessibility, data migration, documentation, training, maintenance and support, reversibility and exit,
  ownership of the code and the data, personal data (GDPR), and anything the need requires;
- risky assumptions, and vague commitments such as "if needed", "standard", "to be defined" or a deliverable without an acceptance criterion;
- whether the days fit the scope, line by line, and whether the price fits the market for this scope, said as a range and as an estimate;
- lock-in: proprietary tools, hosting or licences that tie the person to the provider, and what leaving would cost;
- whether the timeline is realistic.
Facts in <checks> are Quorumind's own computations from the document's figures: take them as true. They name the lines of the document
by their place among the work packages of <extraction> (work package 1 is the first), and never quote the document.`;

/** The formalizer: what the document commits to, as written. */
export function auditExtractorSystem(locale: Locale) {
  return `${PRODUCT}

The person received the document in <document> from a provider and wants it audited against their need, in <requirements>.
You are the formalizer: restate what the document commits to, faithfully. Do not judge it, fix it or complete it.
Copy every figure as the document writes it: the days, day rate and amount of each line, the total and whether it includes tax,
the recurring cost, the timeline. Never compute a figure the document does not give: leave it null. Amounts are plain numbers in the document's currency.
Quote the passage that states each line, the total and the timeline.
Say what the document says about hosting, maintenance and support, warranties, payment terms and the ownership of the code and the data,
and give null for each one it says nothing about: what is missing matters as much as what is there.
In "speech", say in plain words what the document offers.

${DATA_RULE}
${DOCUMENT_RULE}
${STYLE_RULE}
${languageRule(locale)}`;
}

/** A critic of the document. */
export function auditCriticSystem(locale: Locale, seat: string, persona: string | null) {
  return `${PRODUCT}

The person received a document from a provider, in <document>, and wants to know whether it is sound before signing it.
<extraction> restates what it commits to and <requirements> is the person's need. You are critic ${seat}: you propose nothing, you examine the document.
${CHECKLIST_RULE}
${SEVERITY_RULE}
Do not repeat a finding already in <debate>; dig deeper instead. Acknowledge in your speech what is sound.
If the arbiter raised an angle in <probe>, examine the document from that angle first.
Add a question for the person only when its answer would change your judgement.${personaRule(persona)}

${DATA_RULE}
${DOCUMENT_RULE}
${STYLE_RULE}
${languageRule(locale)}`;
}

/** The devil's advocate, against the document. */
export function auditDevilSystem(locale: Locale, persona: string | null) {
  return `${PRODUCT}

The person received a document from a provider, in <document>, and wants to know whether it is sound before signing it.
<extraction> restates what it commits to and <requirements> is the person's need. You are the devil's advocate: you propose nothing.
Read the document as its toughest reviewer would: what will be billed later or is excluded, what it costs at scale, lock-in and the cost of leaving,
what happens if the provider fails or disappears, optimistic days and timelines, vague wording the provider could later read in its favour,
missing warranties, acceptance criteria and penalties.
${CHECKLIST_RULE}
${SEVERITY_RULE}
Hard but fair: no finding without an argument. Do not repeat a finding already in <debate>; find new ones.
If the arbiter raised an angle in <probe>, examine the document from that angle first.
Add a question for the person only when its answer would change your judgement.${personaRule(persona)}

${DATA_RULE}
${DOCUMENT_RULE}
${STYLE_RULE}
${languageRule(locale)}`;
}

const AUDIT_RULING = `In "audit":
- opinion: "sound" when the document can be signed as it is, "sound_with_reservations" when it can once its major findings are settled,
  "not_sound" when a blocking finding remains or the document cannot meet the need as it stands;
- findings: every finding that holds, merged when several critics found the same thing and dropped when the document answers it, the most serious
  first; quote the passage of <document> word for word, or leave quote empty when the document says nothing, and say in "fix" what should change;
- coverage: each item of the checklist once (tests, security, accessibility, data_migration, documentation, training, maintenance, reversibility,
  ownership, gdpr): covered, partial, missing, or not_applicable to this need;
- price: whether the price is consistent with the scope and the days, and the usual market range for this scope in the currency named in <rates>,
  as an estimate with its basis; facts in <checks> are computed by Quorumind from the document's own figures: take them as true over its claims
  (they name a line by its place among the work packages of <extraction>, and never quote the document);
- timeline: whether the stated timeline is realistic for this scope;
- questions: at most ten questions to send the provider, polite, self-contained and ready to send, the most important first;
- negotiation: the points to negotiate before signing, the most valuable first.`;

/** The arbiter's audit of the document. */
export function auditArbiterSystem(locale: Locale, alternative: boolean) {
  const compare = alternative
    ? `\nOption A is an approach a proposer sketched from the need alone, without reading the document, as a point of comparison: rule on it too,
and say in the price comment how the document compares with it.`
    : "";
  return `${PRODUCT}

You are the arbiter. You did not take part in the audit. The person received the document in <document>, restated in <extraction>, and asked whether it is
sound for their need, in <requirements>. The critics' findings are in <debate>.
${AUDIT_RULING}
Option U is the document. Rule on it in "options": feasible, conditional or infeasible against the requirements, with the conditions that must hold,
and score it from 1 to 5 on every priority of the sheet.${compare}
Recommend U (seat "U") unless the opinion is "not_sound"${alternative ? " or option A clearly serves the need better" : ""}; recommend none when nothing fits.
Map in "topics" where the critics agree and where they differ, by seat (A, B…, "devil" for the devil's advocate).
Give the main risks of signing with a mitigation, the next steps as a short roadmap (for instance send the questions, negotiate, sign, follow the
delivery) with an exit criterion each, and the key claims of your audit, each marked verified, estimated or assumed.

${DATA_RULE}
${DOCUMENT_RULE}
${STYLE_RULE}
${languageRule(locale)}`;
}

/** The arbiter rules again on its audit with new facts, such as the provider's answers to the questions. */
export function auditReassessSystem(locale: Locale) {
  return `${PRODUCT}

You are the arbiter. You already audited the document in <document>: your verdict is in <verdict>. New facts arrived since, in <answers>:
the provider's answers to the questions, or corrections from the person. Rule again with them; the audit is not re-run.
Keep every part of the verdict the facts do not change. Change what they change: the opinion, the findings (drop those the facts settle, add one only
when a fact raises it), the coverage, the price and timeline assessments, the questions (drop those answered), the points to negotiate,
the feasibility, conditions and scores of the options, the recommendation, risks, roadmap and claims.
Critiques in <debate>, if any, were written about these facts: weigh them.
In "costs", give the new monthly running cost of an option only when the facts change it, in the currency named in <rates>; leave it empty otherwise.
Keep the same seats. In "speech", say in two to four sentences what the new facts changed, or that they changed nothing.
${AUDIT_RULING}

${DATA_RULE}
${DOCUMENT_RULE}
${STYLE_RULE}
${languageRule(locale)}`;
}

/** The documents under audit, each cut to its share of the budget, in a <document> tag. */
export function documentBlock(documents: ContextDocument[], maxChars: number): string {
  return contextBlock(documents, maxChars, "document");
}

/** What the document commits to, without the formalizer's speech. */
export function extractionBlock(session: Session): string {
  const extraction = session.audit?.extraction;
  if (!extraction) return "";
  const { speech: _speech, ...rest } = extraction;
  return fence("extraction", JSON.stringify(rest, null, 2));
}

const currencyBlock = (session: Session) => fence("rates", `Every amount you give is in ${debateCurrency(session)}.`);

const join = (parts: string[]) => parts.filter(Boolean).join("\n\n");

/**
 * What a role of an audit also follows: the compliance requirements of the need, and the reference cloud prices to
 * judge the hosting and running costs the document states, or to estimate them for the alternative.
 */
function rules(session: Session, role: ComplianceRole): string {
  const compliance = complianceRule(activeRequirements(session), role);
  if (role === "design") return compliance + priceReferenceRule();
  const applies = compliance
    ? `${compliance}
In an audit, these requirements apply to option U, the document: a hard requirement it does not show it meets is a finding.`
    : "";
  return `${applies}

Use the reference cloud prices below to judge the hosting and running costs the document states.${priceReferenceRule()}`;
}

/** The formalizer's prompt: the need, and the document in full or almost. */
export function auditExtractionPrompt(session: Session): Prompt {
  return {
    system: auditExtractorSystem(session.locale),
    messages: [
      {
        role: "user",
        content: join([
          requirementsBlock(requireSheet(session)),
          documentBlock(auditedDocuments(session), AUDIT_BUDGET.extraction),
          "Restate what this document commits to.",
        ]),
      },
    ],
  };
}

/** The alternative of an audit: designed from the need alone, without the document, as an independent comparison. */
export function auditAlternativePrompt(session: Session, seat: string): Prompt {
  return {
    system: proposerSystem(session.locale, seat, session.seats[seat]?.persona ?? null) + rules(session, "design"),
    messages: [
      {
        role: "user",
        content: join([
          requirementsBlock(requireSheet(session)),
          ratesBlock(null, debateCurrency(session)),
          contextBlock(backgroundDocuments(session), CONTEXT_BUDGET.proposal),
          "The person received a provider's proposal for this need, which you do not see. Design the approach you would recommend, as an independent point of comparison: keep it simple and estimate it honestly.",
        ]),
      },
    ],
  };
}

/** A critic's or the devil's advocate's prompt, for one round. */
export function auditCritiquePrompt(session: Session, seat: string, round: number, role: string): Prompt {
  const system = role + rules(session, "critique");
  const earlier = session.debate.flatMap((entry) =>
    entry.kind === "critiques" && entry.round < round ? entry.data.critiques.map((critique) => ({ from: entry.seat, ...critique })) : [],
  );
  const probe = session.debate.findLast((entry) => entry.kind === "probe" && entry.round < round);
  return {
    system,
    messages: [
      {
        role: "user",
        content: join([
          requirementsBlock(requireSheet(session)),
          answersBlock(allAnswers(session)),
          extractionBlock(session),
          checksBlock(quoteFacts(quoteCheck(session))),
          documentBlock(auditedDocuments(session), AUDIT_BUDGET.critique),
          contextBlock(backgroundDocuments(session), CONTEXT_BUDGET.critique),
          earlier.length > 0 ? fence("debate", JSON.stringify(earlier, null, 2)) : "",
          probe?.kind === "probe" ? fence("probe", probe.data.angle) : "",
          `Examine this document. You are ${seat === DEVIL_SEAT ? "the devil's advocate" : `critic ${seat}`}.`,
        ]),
      },
    ],
  };
}

/** The build cost of the options Quorumind priced: the alternative's, from its work packages. */
function computedCosts(session: Session): Record<string, ComputedCost> {
  return Object.fromEntries(
    Object.entries(sessionCostings(session))
      .filter(([, costing]) => costing.rates !== "legacy")
      .map(([seat, costing]) => [
        seat,
        { currency: costing.currency, low: costing.total.low, high: costing.total.high, personDays: costing.days },
      ]),
  );
}

/** The alternative, when there is one, as the arbiter reads it. */
function alternativeBlock(session: Session): string {
  const seat = alternativeSeat(session);
  const proposal: Proposal | undefined = seat ? currentProposals(session)[seat] : undefined;
  return seat && proposal ? proposalsBlock({ [seat]: proposal }, computedCosts(session)) : "";
}

/** The arbiter's prompt: the need, the document and what it commits to, the computed facts and every finding. */
export function auditVerdictPrompt(session: Session): Prompt {
  const transcript = session.debate.flatMap<object>((entry) => {
    if (entry.kind === "critiques") return [{ round: entry.round, from: entry.seat, findings: entry.data.critiques }];
    if (entry.kind === "probe") return [{ round: entry.round, from: "arbiter", angle: entry.data.angle }];
    return [];
  });
  return {
    system: auditArbiterSystem(session.locale, alternativeSeat(session) !== null) + rules(session, "arbiter"),
    messages: [
      {
        role: "user",
        content: join([
          requirementsBlock(requireSheet(session)),
          currencyBlock(session),
          answersBlock(allAnswers(session)),
          extractionBlock(session),
          alternativeBlock(session),
          // The document's price against the budget is in quoteFacts, as stated: the build check of U would call it computed.
          checksBlock([
            ...quoteFacts(quoteCheck(session)),
            ...checkFacts(session).filter((fact) => !fact.startsWith(`Option ${USER_SEAT}: build cost`)),
          ]),
          documentBlock(auditedDocuments(session), AUDIT_BUDGET.verdict),
          contextBlock(backgroundDocuments(session), CONTEXT_BUDGET.critique),
          fence("debate", JSON.stringify(transcript, null, 2)),
          "Give your audit of this document.",
        ]),
      },
    ],
  };
}

/** The arbiter's prompt for a revision of the audit, with the new facts. */
export function auditReassessPrompt(
  session: Session,
  inputs: { facts: RevisionFact[]; note: string | null },
  critiques: { seat: string; data: CritiqueRound }[],
): Prompt {
  const { speech: _speech, ...verdict } = session.verdict ?? { speech: "" };
  const said = critiques.flatMap((entry) => entry.data.critiques.map((critique) => ({ from: entry.seat, ...critique })));
  return {
    system: auditReassessSystem(session.locale) + rules(session, "arbiter"),
    messages: [
      {
        role: "user",
        content: join([
          requirementsBlock(requireSheet(session)),
          currencyBlock(session),
          extractionBlock(session),
          alternativeBlock(session),
          checksBlock(quoteFacts(quoteCheck(session))),
          fence("verdict", JSON.stringify(verdict, null, 2)),
          factsBlock(inputs.facts, inputs.note),
          documentBlock(auditedDocuments(session), AUDIT_BUDGET.critique),
          said.length > 0 ? fence("debate", JSON.stringify(said, null, 2)) : "",
          "Rule again on this audit with the new facts.",
        ]),
      },
    ],
  };
}
