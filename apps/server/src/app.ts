import {
  Audience,
  COMPLIANCE_TEMPLATE_IDS,
  catalogFromEnv,
  clientDeliverable,
  createSession,
  currentView,
  DEMO_IDEA,
  DEMO_LINEUP,
  DEPTHS,
  DebateEngine,
  type DecisionActor,
  deliveryChecks,
  type EuropeanPolicy,
  estimateDebateCost,
  estimateResearchCost,
  estimateRevisionCost,
  europeanPolicyFromEnv,
  hasProfile,
  INTERRUPTED,
  InvalidStateError,
  isLocale,
  isLocalOnly,
  type Lineup,
  LOCALES,
  liveLineupFromEnv,
  MAX_CONTEXT_CHARS,
  MAX_CONTEXT_DOCUMENTS,
  MAX_ROUNDS,
  MODES,
  type ModelOption,
  makerOf,
  type OrgProfile,
  type Participant,
  PERSONA_IDS,
  type PendingRevision,
  PROPOSER_SEATS,
  providersFor,
  type Questionnaire,
  RequirementsSheet,
  type ResearchSettings,
  type RevisionRequest,
  renderClientReport,
  renderReport,
  researchSettingsFromEnv,
  type Session,
  searchFromEnv,
  searchKindFromEnv,
  sessionAtRevision,
  sessionCostings,
  TEMPLATE_IDS,
  type UsageRecord,
} from "@quorumind/core";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { type BrandingStore, SqliteBrandingStore } from "./branding.ts";
import type { EventBus } from "./bus.ts";
import { clientAddress, trustedProxies } from "./caller.ts";
import type { ChatNotifier } from "./chat.ts";
import { contextRoutes } from "./context/routes.ts";
import { decisionRoutes, sendReviewReminders } from "./decisions.ts";
import { invalidRequest } from "./errors.ts";
import { EuropeanUnavailable, europeanConfig, europeanSession, NonEuropeanModel, wantsEuropean } from "./european.ts";
import { exportRoutes } from "./exports.ts";
import { localGuard } from "./guard.ts";
import type { Notifier } from "./notifier.ts";
import { profileRoutes } from "./profile.ts";
import { questionnaireRoutes } from "./questionnaires.ts";
import {
  accessToken,
  hashPassword,
  PasswordAttempts,
  SHARE_EXPIRIES,
  SHARE_MODES,
  SHARE_PASSWORD,
  type ShareExpiry,
  validAccess,
} from "./share.ts";
import {
  MissingSession,
  type Placement,
  publicQuestionnaire,
  type SessionStore,
  type ShareSettings,
  type StoredQuestionnaire,
  type StoredSession,
  type StoredShare,
} from "./store.ts";

type Env = Record<string, string | undefined>;

export interface User {
  userId: string;
}

/** The groups a caller shares sessions with (the workspaces of the hosted version). */
export interface Scope {
  /** Where the caller's new sessions are created, and whose history they see; null outside any group. */
  workspace: string | null;
  /** Every group whose sessions the caller may read, `workspace` included. */
  workspaces: string[];
}

/** The author of a session someone else started, as a shared history shows it. */
export interface Author {
  name: string | null;
  email: string | null;
}

/** What the caller may do with a session, sent with it. */
export interface SessionAccess {
  /** The caller started it. */
  mine: boolean;
  /** The caller may change it (answer, confirm, resume, delete, share); otherwise they may read and fork it. */
  canEdit: boolean;
  /** It belongs to a workspace whose members can read it. */
  shared: boolean;
  private: boolean;
  /** Who started it, when someone else did and the host names authors; null for a former member. */
  author?: Author | null;
}
/**
 * Why the host refuses to spend: no credits left, a limit of the plan, the cost cap included in the debate's price,
 * no seat left in the workspace. The web app translates each of them.
 */
export type SpendRefusal = "insufficient_credits" | "plan_limit" | "price_limit" | "seat_limit";

/** The settings of a session its price can depend on. */
export type PricedSettings = Pick<Session, "mode" | "depth" | "locale">;

/** What is priced: a session's debate, or a revision of its verdict (the next one). */
export type PricedItem = "debate" | "revision";

/** What model work is for: the debate (its interview, rounds, verdict and briefs), or one revision of its verdict. */
export type Purchase = { kind: "debate" } | { kind: "revision"; number: number };

/**
 * A step in the life of a verdict revision. started: it is recorded and no model was called yet. completed: the new
 * verdict exists. failed: it stopped before, and the current verdict stays. Each attempt has its own id.
 */
export interface RevisionEvent {
  id: string;
  number: number;
  reason: PendingRevision["reason"];
  status: "started" | "completed" | "failed";
}

/** What a debate costs the person, as the host sells it. */
export interface PriceQuote {
  /** In `currency`; 0 when the person's plan covers it. */
  amount: number;
  /** ISO 4217 code, e.g. "EUR". */
  currency: string;
  /** What is bought, in the session's language, e.g. "Standard debate". */
  label: string;
}

/**
 * Extension points used by the hosted version. Self-hosted, none is set: there is a single
 * local user, every configured model is available and nothing is metered.
 */
export interface AppHooks {
  /** Who is calling. When provided, a null result means 401 and every session is scoped to its owner. */
  identify?(request: Request): Promise<User | null>;
  /**
   * Called before any model work starts or resumes. Refusing answers HTTP 402 with the code, which the interface
   * explains; `reason` is the English message sent with it. `purchase` says what the work is for: the debate, unless
   * it is a revision of the verdict.
   */
  authorizeSpend?(
    user: User,
    session: Session,
    estimateUsd: number,
    purchase?: Purchase,
  ): Promise<{ ok: true } | { ok: false; reason: string; code: SpendRefusal }>;
  /**
   * The life of each verdict revision, for the person who asked for it: a host selling revisions charges on
   * "started" and gives back on "failed". Throwing on "started" cancels the revision before any model call.
   */
  onRevision?(user: User, session: Session, event: RevisionEvent): void | Promise<void>;
  /** The provider cost cap of one verdict revision, in US dollars; without it, a revision has no cap of its own. */
  revisionBudgetUsd?(session: Session): number | null;
  /**
   * After a client submitted a questionnaire through its link, for the owner of the session (null for the single
   * local user of a self-hosted server). The notifier, when there is one, sends its e-mail as well.
   */
  onQuestionnaireSubmitted?(owner: User | null, session: Session, questionnaire: Questionnaire): void | Promise<void>;
  /** After every model call, with its real cost (null when the price is unknown). */
  onUsage?(user: User, session: Session, record: UsageRecord): void | Promise<void>;
  /** The models this user may pick. */
  catalog?(user: User): Promise<ModelOption[]>;
  /** The environment (API keys, base URLs) used to call the models for this user. */
  providerEnv?(user: User): Env;
  /** Where to send this user's notifications. */
  notifyRecipient?(user: User): Promise<string | null>;
  /** Forces a cost cap on every session, in US dollars. */
  maxBudgetUsd?: number;
  /**
   * The provider cost cap of a new session from its settings, in US dollars (e.g. one cap per price
   * tier). The lowest of this, maxBudgetUsd and the person's own cap applies.
   */
  sessionBudgetUsd?(settings: Pick<Session, "mode" | "depth">): number | null;
  /**
   * The price of a debate for this user, shown before launch instead of the provider cost estimate
   * and in the session header. `sessionId` is set once the session exists. Null shows no price. With `item`
   * "revision", the price of the session's next verdict revision, shown on the button that makes it.
   */
  quote?(user: User, settings: PricedSettings, sessionId: string | null, item?: PricedItem): Promise<PriceQuote | null>;
  /**
   * Keeps provider costs, in US dollars, away from the people using the app: sessions are sent
   * without the cost of each call or the cost cap, and the interface shows calls and tokens only.
   */
  hideProviderCosts?: boolean;
  /**
   * Shares sessions within groups: a new session is created in the caller's workspace, the history lists that
   * workspace's sessions, and every member can read and fork them, unless their author made them private. Without
   * it, a session is visible to its owner only.
   */
  scope?(user: User): Promise<Scope>;
  /**
   * Whether the caller may change a session of their workspace that someone else started (answer, confirm, resume,
   * delete, share), e.g. its owners and admins. Without it, only the author can.
   */
  canEdit?(user: User, session: Placement & { id: string }): Promise<boolean>;
  /** The authors of sessions others started, by owner id; an id left out shows as a former member. */
  authors?(owners: string[]): Promise<Record<string, Author>>;
  /**
   * The organisation profile a new session follows (its proposals stay within it and are priced with its day rates),
   * e.g. the one of the workspace it is started in; null for none. Read once, when the session is created: the
   * session keeps a copy. Without it, the profile is the one saved in the settings of this server (/api/profile).
   */
  profile?(user: User, session: Session): Promise<OrgProfile | null>;
  /**
   * Whether new sessions of this user use European models only (sovereignty.ts): "default" ticks the option, "required"
   * imposes it, e.g. a workspace setting. Without it, QUORUMIND_EUROPEAN_ONLY decides.
   */
  europeanPolicy?(user: User): Promise<EuropeanPolicy>;
  /**
   * Web research for a new session of these settings: whether it is ticked by default, and its limits (e.g. on for the
   * tiers whose price includes it). The person can still change it, when a search engine is configured. Without it,
   * research is ticked once QUORUMIND_SEARCH is configured, with the limits of QUORUMIND_RESEARCH_*.
   */
  research?(settings: Pick<Session, "mode" | "depth">): { default: boolean; limits: ResearchSettings };
}

export interface AppDeps {
  store: SessionStore;
  bus: EventBus;
  env: Env;
  hooks?: AppHooks;
  notifier?: Notifier | null;
  /** Slack or Teams messages when a session waits, finishes or fails, whatever its e-mail setting. */
  chat?: ChatNotifier | null;
  /** Delay between streamed chunks of the demo; 0 in tests. */
  mockDelayMs?: number;
  /** White-label branding of the exports and the organisation profile; kept in memory when not given. */
  brandingStore?: BrandingStore;
  /** The address of the interface, for the links of the exports (the register's CSV); the request's origin otherwise. */
  publicUrl?: string | null;
}

const AnswerList = z.array(z.object({ question: z.string().max(2_000), answer: z.string().max(4_000) })).max(20);

const ParticipantInput = z.object({ provider: z.string(), model: z.string().max(200) });
const SeatInput = ParticipantInput.extend({ persona: z.string().trim().max(200).nullable().default(null) });

const LineupInput = z.object({
  interviewer: ParticipantInput,
  arbiter: ParticipantInput,
  seats: z.partialRecord(z.enum(PROPOSER_SEATS), SeatInput),
  devil: SeatInput.nullable().default(null),
});

const ContextInput = z
  .array(
    z.object({
      id: z.string().max(100),
      kind: z.enum(["file", "url", "github", "text"]),
      name: z.string().max(300),
      text: z.string().max(MAX_CONTEXT_CHARS),
      source: z.string().max(2_000).optional(),
      truncated: z.boolean().optional(),
    }),
  )
  .max(MAX_CONTEXT_DOCUMENTS)
  .default([]);

/** Sessions whose acting user is remembered at most. */
const MAX_USERS = 10_000;

/** How often visits to a client link may try again to write its missing client brief. */
const BRIEF_RETRY_MS = 15 * 60_000;

/** Request bodies are capped at 512 KB, except session creation, which carries the attached documents. */
export const BODY_LIMITS = { api: 512 * 1024, session: 4 * 1024 * 1024 } as const;

/** Audit mode: the attached documents under audit (every attached one when none is named), and the alternative to sketch. */
const AuditInput = z
  .object({
    documentIds: z.array(z.string().max(100)).max(MAX_CONTEXT_DOCUMENTS).default([]),
    alternative: z.boolean().default(false),
  })
  .nullable()
  .default(null);

const NewSession = z.object({
  locale: z.string().refine(isLocale, "Unsupported language"),
  idea: z.string().trim().max(4_000).default(""),
  demo: z.boolean().default(false),
  mode: z.enum(MODES).default("standard"),
  template: z.enum(TEMPLATE_IDS).nullable().default(null),
  /** Compliance templates, combined with the domain template. */
  complianceTemplates: z.array(z.enum(COMPLIANCE_TEMPLATE_IDS)).max(COMPLIANCE_TEMPLATE_IDS.length).default([]),
  /** Every role played by a European model; left out, the server's or the workspace's default applies. */
  europeanOnly: z.boolean().optional(),
  /** Web research before the proposals; left out, the default of the server or of the session's tier applies. */
  webResearch: z.boolean().optional(),
  depth: z.enum(DEPTHS).default("standard"),
  rounds: z.number().int().min(1).max(MAX_ROUNDS).default(1),
  budgetUsd: z.number().positive().max(1_000).nullable().default(null),
  lineup: LineupInput.nullable().default(null),
  challenge: z.string().trim().max(8_000).nullable().default(null),
  audit: AuditInput,
  context: ContextInput,
  redact: z.boolean().default(false),
  notify: z.boolean().default(false),
  /** Hidden from the other members of the caller's workspace. */
  private: z.boolean().default(false),
});

const ResumeInput = z.object({ budgetUsd: z.number().positive().max(1_000).nullable().optional() });

const RevisionInput = z.object({
  facts: z
    .array(
      z.object({
        question: z
          .string()
          .trim()
          .max(2_000)
          .nullable()
          .default(null)
          .transform((value) => value || null),
        answer: z.string().trim().max(4_000),
        comment: z
          .string()
          .trim()
          .max(2_000)
          .nullable()
          .default(null)
          .transform((value) => value || null),
      }),
    )
    .max(20)
    .default([]),
  note: z
    .string()
    .trim()
    .max(4_000)
    .nullable()
    .default(null)
    .transform((value) => value || null),
});

/**
 * A session through a "full" share link: everything but its costs, its cost cap, its attached documents and what is
 * internal to the organisation: the day rates, capacity and notes of its profile, who did what (user ids), and the
 * comments and note of the decision. The names of those who asked for and gave the approval stay: the owner chose
 * to show the whole decision.
 */
function publicView(session: Session): Session {
  const actor = (by: DecisionActor): DecisionActor => ({ id: null, name: by.name });
  const decision = session.decision;
  return {
    ...session,
    context: session.context.map(({ source: _source, ...doc }) => ({ ...doc, text: "" })),
    usage: [],
    budgetUsd: null,
    ...withoutResearchCosts(session),
    error: session.error ? { code: session.error.code, message: "" } : null,
    notify: false,
    profile: session.profile
      ? {
          ...session.profile,
          roles: session.profile.roles.map((role) => ({ ...role, dailyRate: 0 })),
          capacity: { people: null, typicalTeamSize: null },
          hosting: { ...session.profile.hosting, notes: "" },
          notes: "",
        }
      : null,
    revisions: session.revisions.map((revision) => ({ ...revision, by: null })),
    revising: session.revising
      ? {
          ...session.revising,
          by: null,
          error: session.revising.error ? { code: session.revising.error.code, message: "" } : null,
        }
      : null,
    decision: decision
      ? {
          ...decision,
          note: null,
          approval: decision.approval ? { ...decision.approval, by: actor(decision.approval.by), comment: null } : null,
          request: decision.request ? { ...decision.request, by: actor(decision.request.by), comment: null } : null,
          closure: decision.closure ? { ...decision.closure, by: actor(decision.closure.by), comment: null } : null,
          history: decision.history.map((event) => ({ ...event, by: actor(event.by), comment: null })),
        }
      : null,
  };
}

const ShareInput = z.object({
  public: z.boolean().optional(),
  mode: z.enum(SHARE_MODES).optional(),
  expiresIn: z.enum(Object.keys(SHARE_EXPIRIES) as [ShareExpiry, ...ShareExpiry[]]).optional(),
  /** A new password, or null to remove it. */
  password: z.string().min(SHARE_PASSWORD.min).max(SHARE_PASSWORD.max).nullable().optional(),
});
const AccessInput = z.object({ password: z.string().max(SHARE_PASSWORD.max) });

/** The web research without its cost cap, and without a failure message that names it in dollars. */
function withoutResearchCosts(session: Session): Pick<Session, "webResearch" | "research"> {
  const { research } = session;
  return {
    webResearch: session.webResearch ? { ...session.webResearch, budgetUsd: null } : null,
    research: research?.error?.code === "budget_exceeded" ? { ...research, error: { code: research.error.code, message: "" } } : research,
  };
}

/** A session as sent to someone who must not see what the providers charge (AppHooks.hideProviderCosts). */
function withoutProviderCosts(session: Session): Session {
  return {
    ...session,
    budgetUsd: null,
    ...withoutResearchCosts(session),
    usage: session.usage.map((record) => ({ ...record, costUsd: null })),
    // The engine's message and parameters name the cap in dollars; the error code is enough to explain it.
    error: session.error?.code === "budget_exceeded" ? { code: session.error.code, message: "" } : session.error,
  };
}

/** The lowest of the cost caps that apply, or null when none does. */
function lowestCap(...caps: (number | null | undefined)[]): number | null {
  const set = caps.filter((cap): cap is number => typeof cap === "number");
  return set.length > 0 ? Math.min(...set) : null;
}

const slug = (session: Session) =>
  (session.sheet?.projectName ?? "quorumind")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "quorumind";

export function createApp(deps: AppDeps) {
  const { store, bus, env, hooks = {} } = deps;
  const settings = deps.brandingStore ?? new SqliteBrandingStore(":memory:");
  /** The claim of each session some action is working on (see Claim). */
  const claims = new Map<string, Claim>();
  /** Set once the server shuts down: no new work starts. */
  let draining = false;
  /** The usage records already reported to AppHooks.onUsage, whichever engine saw them. */
  const reportedUsage = new WeakSet<UsageRecord>();
  /** Who acts for each session (its spending checks, usage records and notifications), the most recent last. */
  const users = new Map<string, User | null>();
  /** Bounded: the oldest entries go, except those of the sessions some work holds. */
  const rememberUser = (id: string, user: User | null) => {
    users.delete(id);
    users.set(id, user);
    for (const key of users.keys()) {
      if (users.size <= MAX_USERS) break;
      if (!claims.has(key)) users.delete(key);
    }
  };
  const passwords = new PasswordAttempts();
  /** The reverse proxies in front of the server, whose X-Forwarded-For gives the client's address (caller.ts). */
  const proxies = trustedProxies(env);
  const mockOptions = deps.mockDelayMs === undefined ? {} : { mockDelayMs: deps.mockDelayMs };

  // Ollama discovery takes a network call: done once, then reused.
  let catalogCache: Promise<ModelOption[]> | null = null;
  const catalogFor = (user: User | null): Promise<ModelOption[]> => {
    if (user && hooks.catalog) return hooks.catalog(user);
    catalogCache ??= catalogFromEnv(env).catch(() => []);
    return catalogCache;
  };
  const envFor = (user: User | null): Env => (user && hooks.providerEnv ? hooks.providerEnv(user) : env);
  const europeanPolicyOf = (user: User | null): Promise<EuropeanPolicy> =>
    user && hooks.europeanPolicy ? hooks.europeanPolicy(user) : Promise.resolve(europeanPolicyFromEnv(env));
  const view = (session: Session) => (hooks.hideProviderCosts ? withoutProviderCosts(session) : session);
  const priceOf = (user: User | null, priced: PricedSettings, sessionId: string | null, item: PricedItem = "debate") =>
    user && hooks.quote ? hooks.quote(user, priced, sessionId, item) : Promise.resolve(null);

  /**
   * The profile a new session follows: the host's, else the one saved in the settings. The recorded demo follows none,
   * nor does an audit: the document is a third party's, judged on its own figures.
   */
  const profileFor = async (user: User | null, session: Session): Promise<OrgProfile | null> => {
    if (session.demo || session.mode === "audit") return null;
    const profile = hooks.profile ? (user ? await hooks.profile(user, session) : null) : await settings.profile(ownerOf(user));
    return hasProfile(profile) ? structuredClone(profile) : null;
  };

  /**
   * Claims a session for one action, synchronously: a second action on it is refused (session_busy) until the claim is
   * released, so two concurrent requests cannot both start work. Taken right after the session is loaded, before any
   * await, and released by its holder only.
   */
  const claim = (session: Session): Claim => {
    if (claims.has(session.id)) throw new InvalidStateError("This session is already working. Wait for it to finish.", "session_busy");
    if (draining) throw new InvalidStateError("The server is shutting down. Try again in a moment.", "session_busy");
    let finish = () => {};
    const held: Claim = {
      controller: new AbortController(),
      background: false,
      done: new Promise<void>((resolve) => {
        finish = resolve;
      }),
      release: () => {
        if (claims.get(session.id) === held) claims.delete(session.id);
        finish();
      },
    };
    claims.set(session.id, held);
    return held;
  };

  /** Runs an action under a claim of the session: released when the action ends, unless a worker took its work over. */
  const withClaim = async <T>(session: Session, action: (held: Claim) => Promise<T>): Promise<T> => {
    const held = claim(session);
    try {
      return await action(held);
    } finally {
      if (!held.background) held.release();
    }
  };

  const engineFor = (session: Session, signal?: AbortSignal) => {
    const user = users.get(session.id) ?? null;
    let reported = session.usage.length;
    let providers: ReturnType<typeof providersFor>;
    try {
      providers = providersFor(session, envFor(user), mockOptions);
    } catch (error) {
      // An SDK that cannot be set up, without its API key for instance.
      throw new ProviderUnavailable(error);
    }
    return new DebateEngine(
      providers,
      {
        emit: (id, event) => bus.publish(id, event),
        save: async (updated) => {
          // The calls not reported yet are taken before any await: the engine saves concurrently (the seats work in
          // parallel), and each save reports its own calls only. A call is reported once even when the save fails.
          const fresh = updated.usage.slice(reported).filter((record) => !reportedUsage.has(record));
          reported = updated.usage.length;
          for (const record of fresh) reportedUsage.add(record);
          try {
            await store.save(updated);
          } finally {
            if (user && hooks.onUsage) for (const record of fresh) await hooks.onUsage(user, updated, record);
          }
        },
      },
      signal ? { signal } : {},
    );
  };

  /**
   * Web research for a new session of these settings: the engine this user's searches would use (null: none is
   * configured), whether it is ticked by default, and its limits.
   */
  const researchOf = (user: User | null, settings: Pick<Session, "mode" | "depth">) => {
    const providerEnv = envFor(user);
    const kind = searchKindFromEnv(providerEnv);
    const hosted = user && hooks.research ? hooks.research(settings) : null;
    return { kind, default: kind !== null && (hosted?.default ?? true), limits: hosted?.limits ?? researchSettingsFromEnv(providerEnv) };
  };

  /** The most a session's web research should cost: its searches and the researcher's calls, within its budget. */
  const researchEstimate = (user: User | null, researcherModel: string, limits: ResearchSettings | null): number => {
    if (!limits) return 0;
    const searchUsd = searchFromEnv(envFor(user))?.estimateUsd ?? 0;
    const cost = estimateResearchCost({ researcherModel, maxQueries: limits.maxQueries, searchUsd }) ?? 0;
    return Math.min(cost, limits.budgetUsd ?? cost);
  };

  const estimateFor = (
    session: {
      seats: Record<string, { model: string }>;
      devil: { model: string } | null;
      arbiter: { model: string };
      rounds: number;
      mode: Session["mode"];
      audit?: { alternative: boolean } | null;
    },
    researchUsd = 0,
  ) => {
    const seatModels = Object.values(session.seats).map((seat) => seat.model);
    const devil = session.devil ? [session.devil.model] : [];
    // Challenge and audit: every seat criticises the one option. An audit's alternative is one more proposal, not revised.
    const criticsOnly = session.mode === "challenge" || session.mode === "audit";
    const alternative = session.mode === "audit" && session.audit?.alternative ? seatModels.slice(0, 1) : [];
    const debate = estimateDebateCost({
      proposerModels: criticsOnly ? [] : seatModels,
      ...(alternative.length > 0 ? { draftModels: alternative } : {}),
      criticModels: criticsOnly ? [...seatModels, ...devil] : devil,
      arbiterModel: session.arbiter.model,
      rounds: session.rounds,
    });
    return debate && { low: debate.low + researchUsd / 2, high: debate.high + researchUsd };
  };

  const authorize = async (session: Session, purchase: Purchase = { kind: "debate" }) => {
    const user = users.get(session.id) ?? null;
    if (!user || !hooks.authorizeSpend || session.demo) return;
    const critic = session.devil?.model ?? Object.values(session.seats)[0]?.model ?? null;
    const estimate =
      purchase.kind === "revision"
        ? (estimateRevisionCost({ arbiterModel: session.arbiter.model, criticModel: critic })?.high ?? 0.5)
        : session.verdict
          ? 0.05
          : (estimateFor(session, session.european ? 0 : researchEstimate(user, session.interviewer.model, session.webResearch))?.high ??
            1);
    const answer = await hooks.authorizeSpend(user, session, estimate, purchase);
    if (!answer.ok) throw new PaymentRequired(answer.code, answer.reason);
  };

  const notify = async (session: Session) => {
    if (session.phase !== "complete" && session.phase !== "awaiting_answers" && session.phase !== "failed") return;
    if (deps.chat) await deps.chat.notify(session, session.phase, await store.find(session.id));
    if (!deps.notifier || !session.notify) return;
    const user = users.get(session.id) ?? null;
    const recipient = user && hooks.notifyRecipient ? await hooks.notifyRecipient(user) : null;
    // With sign-in, the server's default address (QUORUMIND_NOTIFY_EMAIL) is nobody's: no recipient, no e-mail.
    if (!recipient && hooks.identify) return;
    await deps.notifier.notify(session, session.phase, recipient);
  };

  // A client share link shows the verdict rewritten for a client: it is written once the verdict exists and such a
  // link does. Its failure only leaves the deliverable without it. The caller holds the session's claim.
  const clientBrief = async (session: Session, held: Claim) => {
    if (session.phase !== "complete" || session.briefs.client) return;
    // Hosted, a model call is made on behalf of its owner only: through a link, the owner may be unknown here.
    if (hooks.identify && !users.get(session.id)) return;
    try {
      await authorize(session);
      await engineFor(session, held.controller.signal).writeBrief(session, "client");
    } catch (error) {
      console.error(`The client brief of session ${session.id} failed:`, error);
    }
  };
  /** Writes the client brief now, unless the session is working or has one. */
  const writeClientBrief = async (session: Session) => {
    if (claims.has(session.id) || draining || session.phase !== "complete" || session.briefs.client) return;
    await withClaim(session, (held) => clientBrief(session, held));
  };
  /** When a visit to a client link last tried again to write a missing client brief, by session. */
  const briefRetries = new Map<string, number>();
  /**
   * A visit to a client link whose brief is missing (its writing failed) tries again, once in a while only: visitors
   * are anonymous, and each attempt calls a model on the owner's account.
   */
  const retryClientBrief = (session: Session) => {
    if (session.phase !== "complete" || session.briefs.client) return;
    const now = Date.now();
    if ((briefRetries.get(session.id) ?? Number.NEGATIVE_INFINITY) > now - BRIEF_RETRY_MS) return;
    briefRetries.set(session.id, now);
    if (briefRetries.size > 1_000) {
      for (const [id, at] of briefRetries) if (at <= now - BRIEF_RETRY_MS) briefRetries.delete(id);
    }
    void writeClientBrief(session);
  };

  // Long operations run in the background; the client follows them through the event stream. Each one can be
  // stopped (POST /stop), which cancels the model calls in flight. The worker takes the action's claim over and
  // releases it when its work ends.
  const runInBackground = (session: Session, held: Claim, work: (engine: DebateEngine) => Promise<void>) => {
    if (claims.get(session.id) !== held || held.background) throw new Error(`Session ${session.id} is not claimed by this action.`);
    // Built before the hand-over: a provider that cannot be set up fails the request, and its claim is released.
    const engine = engineFor(session, held.controller.signal);
    held.background = true;
    void Promise.resolve()
      .then(() => work(engine))
      .then(async () => {
        // The person who stopped the session knows, and an interrupted one resumes: no e-mail for either.
        if (session.error?.code !== "stopped" && session.error?.code !== "interrupted") {
          // A mail server or chat channel that fails does not keep the client brief from being written.
          await notify(session).catch((error: unknown) => console.error(`The notifications of session ${session.id} failed:`, error));
        }
        if (session.phase === "complete" && (await store.shareOf(session.id))?.mode === "client") await clientBrief(session, held);
      })
      .catch((error) => console.error(`Session ${session.id} failed:`, error))
      .finally(() => held.release());
  };

  const app = new Hono<{ Variables: { user: User | null } }>();
  // Without sign-in, the server trusts whoever reaches it: it refuses foreign host names (DNS rebinding), requests
  // from other sites and bodies that are not JSON (cross-site requests). With sign-in, the host protects its own.
  if (!hooks.identify) app.use("/api/*", localGuard(env, deps.publicUrl ?? null));
  const tooLarge = (c: Context) => c.json({ error: "too_large", message: "The request is too large." }, 413);
  const apiLimit = bodyLimit({ maxSize: BODY_LIMITS.api, onError: tooLarge });
  const sessionLimit = bodyLimit({ maxSize: BODY_LIMITS.session, onError: tooLarge });
  // The import routes set their own limits (a 10 MB file upload, for instance).
  app.use("/api/*", (c, next) => {
    if (c.req.path.startsWith("/api/context/")) return next();
    return (c.req.path === "/api/sessions" ? sessionLimit : apiLimit)(c, next);
  });

  const open = ["/api/health", "/api/config", "/api/gallery"];
  app.use("/api/*", async (c, next) => {
    if (!hooks.identify) {
      c.set("user", null);
      return next();
    }
    const user = await hooks.identify(c.req.raw);
    // Share links and questionnaire links need no account.
    const link = c.req.path.startsWith("/api/shared/") || c.req.path.startsWith("/api/questionnaire/");
    if (!user && !open.includes(c.req.path) && !link) {
      return c.json({ error: "unauthorized", message: "Sign in to continue." }, 401);
    }
    c.set("user", user);
    return next();
  });

  app.get("/api/health", (c) => c.json({ ok: true }));

  app.get("/api/config", async (c) => {
    const user = c.get("user");
    const catalog = await catalogFor(user);
    const lineup = hooks.catalog && user ? defaultLineup(catalog) : liveLineupFromEnv(envFor(user), catalog);
    const estimate = (value: Lineup) => (hooks.hideProviderCosts ? null : estimateFor({ ...value, rounds: 1, mode: "standard" }));
    return c.json({
      locales: LOCALES,
      catalog,
      live: lineup ? { lineup, estimateUsd: estimate(lineup) } : null,
      demo: { lineup: DEMO_LINEUP, idea: DEMO_IDEA },
      templates: TEMPLATE_IDS,
      complianceTemplates: COMPLIANCE_TEMPLATE_IDS,
      european: europeanConfig(await europeanPolicyOf(user), catalog, envFor(user)),
      personas: PERSONA_IDS,
      localOnly: isLocalOnly(env),
      notifications: Boolean(deps.notifier),
      retentionDays: retentionDays(env),
      maxBudgetUsd: hooks.hideProviderCosts ? null : (hooks.maxBudgetUsd ?? null),
      providerCosts: !hooks.hideProviderCosts,
      // False when the host provides the organisation profiles (AppHooks.profile): they are not edited in this app.
      profileSettings: !hooks.profile,
      // True when nobody names the people who approve decisions (self-hosted): the register asks for a name.
      typedNames: !hooks.authors,
      // The search engine of the web research (null: off), and whether a standard debate has it ticked.
      research: (({ kind, default: on }) => ({ kind, default: on }))(researchOf(user, { mode: "standard", depth: "standard" })),
    });
  });

  app.post("/api/estimate", async (c) => {
    const input = z
      .object({
        lineup: LineupInput,
        rounds: NewSession.shape.rounds,
        mode: NewSession.shape.mode,
        audit: NewSession.shape.audit,
        depth: NewSession.shape.depth,
        locale: NewSession.shape.locale.default("en"),
        webResearch: NewSession.shape.webResearch,
        europeanOnly: NewSession.shape.europeanOnly,
      })
      .parse(await c.req.json());
    const user = c.get("user");
    const research = researchOf(user, input);
    // A European-only debate searches nothing: off by default, and nothing to pay for even when asked.
    const european = wantsEuropean(await europeanPolicyOf(user), input.europeanOnly);
    const researchUsd =
      !european && (input.webResearch ?? research.default) && research.kind
        ? researchEstimate(user, input.lineup.interviewer.model, research.limits)
        : 0;
    return c.json({
      estimateUsd: hooks.hideProviderCosts
        ? null
        : estimateFor({ ...input.lineup, rounds: input.rounds, mode: input.mode, audit: input.audit }, researchUsd),
      price: await priceOf(user, { mode: input.mode, depth: input.depth, locale: input.locale as Session["locale"] }, null),
      // Whether these settings have web research ticked by default (e.g. by price tier).
      research: { kind: research.kind, default: research.default && !european },
    });
  });

  const scopeOf = (user: User | null): Promise<Scope | null> => (user && hooks.scope ? hooks.scope(user) : Promise.resolve(null));
  const ownerOf = (user: User | null) => user?.userId ?? null;

  // ?mine=1 keeps the caller's own sessions, in a workspace's shared history.
  app.get("/api/sessions", async (c) => {
    const user = c.get("user");
    const scope = await scopeOf(user);
    if (!user || !scope) return c.json({ sessions: await store.list(50, ownerOf(user)), shared: false });
    const entries = await store.history(50, { owner: user.userId, workspace: scope.workspace, mine: c.req.query("mine") === "1" });
    const others = [...new Set(entries.flatMap((entry) => (entry.owner && entry.owner !== user.userId ? [entry.owner] : [])))];
    const authors = hooks.authors && others.length > 0 ? await hooks.authors(others) : null;
    const sessions = entries.map(({ owner, workspace: _workspace, private: isPrivate, ...summary }) => {
      const mine = owner === user.userId;
      return { ...summary, private: isPrivate, mine, ...(authors && !mine ? { author: authors[owner ?? ""] ?? null } : {}) };
    });
    return c.json({ sessions, shared: scope.workspace !== null });
  });

  app.post("/api/sessions", async (c) => {
    const user = c.get("user");
    const input = NewSession.parse(await c.req.json());
    let lineup: Lineup;
    let european: Session["european"] = null;
    if (input.demo) {
      lineup = DEMO_LINEUP;
    } else {
      const catalog = await catalogFor(user);
      if (wantsEuropean(await europeanPolicyOf(user), input.europeanOnly)) {
        ({ lineup, european } = europeanSession(input.lineup ? validateLineup(input.lineup, catalog) : null, catalog, envFor(user)));
      } else if (input.lineup) {
        lineup = validateLineup(input.lineup, catalog);
      } else {
        const fallback = hooks.catalog && user ? defaultLineup(catalog) : liveLineupFromEnv(envFor(user), catalog);
        if (!fallback) {
          return c.json({ error: "live_unavailable", message: "No AI model is configured. Add an API key, or try the demo." }, 400);
        }
        lineup = fallback;
      }
      if (!input.idea) return c.json({ error: "idea_missing", message: "Describe your project idea." }, 400);
      if (input.mode === "challenge" && !input.challenge) {
        return c.json({ error: "challenge_missing", message: "Describe the solution you want challenged." }, 400);
      }
      if (input.mode === "audit" && input.context.length === 0) {
        return c.json(
          { error: "audit_document_missing", message: "Attach the document to audit: a quote, a statement of work or a proposal." },
          400,
        );
      }
    }
    const mode = input.demo ? "standard" : input.mode;
    // The demo replays its recorded research. A European-only debate searches nothing: off unless asked, and the
    // report then says why.
    const research = input.demo
      ? { kind: "demo", default: true, limits: researchSettingsFromEnv({}) }
      : researchOf(user, { mode, depth: input.depth });
    const webResearch = (input.webResearch ?? (research.default && !european)) ? research.limits : null;
    const session = createSession({
      locale: input.locale as Session["locale"],
      idea: input.demo ? input.idea || DEMO_IDEA : input.idea,
      demo: input.demo,
      mode,
      template: input.template,
      complianceTemplates: input.demo ? [] : input.complianceTemplates,
      european,
      webResearch,
      depth: input.depth,
      rounds: input.rounds,
      budgetUsd: lowestCap(input.budgetUsd, hooks.maxBudgetUsd, hooks.sessionBudgetUsd?.({ mode, depth: input.depth })),
      ...lineup,
      challenge: input.challenge,
      audit: input.audit,
      context: input.context,
      redact: input.redact,
      notify: input.notify && Boolean(deps.notifier),
    });
    session.profile = await profileFor(user, session);
    rememberUser(session.id, user);
    return withClaim(session, async (held) => {
      await authorize(session);
      // Its models are set up before it is saved: a missing API key leaves nothing behind.
      engineFor(session);
      const workspace = (await scopeOf(user))?.workspace ?? null;
      await store.save(session, ownerOf(user), { workspace, private: input.private && workspace !== null });
      runInBackground(session, held, (engine) => engine.startInterview(session));
      return c.json({ session: view(session) }, 201);
    });
  });

  /**
   * What the caller may do with a session: its owner everything; with AppHooks.scope, the other members of its
   * workspace read it (unless it is private) and change it when AppHooks.canEdit allows. Anyone else gets a 404.
   */
  const accessOf = async (id: string, user: User | null): Promise<StoredSession & { access: SessionAccess }> => {
    const found = await store.find(id);
    if (!found) throw new NotFound();
    const mine = found.owner === ownerOf(user);
    const scope = found.workspace === null ? null : await scopeOf(user);
    if (!user || !scope) {
      if (!mine) throw new NotFound();
      return { ...found, access: { mine, canEdit: true, shared: false, private: found.private } };
    }
    // A session belongs to its workspace: whoever left it, its author included, no longer sees it.
    if (!scope.workspaces.includes(found.workspace ?? "") || (found.private && !mine)) throw new NotFound();
    const { session: _session, ...placement } = found;
    const canEdit = mine || (hooks.canEdit ? await hooks.canEdit(user, { id, ...placement }) : false);
    return { ...found, access: { mine, canEdit, shared: true, private: found.private } };
  };

  /** A session the caller may read. */
  const load = async (id: string, user: User | null) => {
    const { session, access } = await accessOf(id, user);
    if (!users.has(id) && access.mine) rememberUser(id, user);
    return session;
  };

  /**
   * A session the caller may change, with its placement: 403 for a member who may only read it. The model work it
   * starts is done for the caller (their spending checks, usage records and notifications).
   */
  const editable = async (id: string, user: User | null) => {
    const found = await accessOf(id, user);
    if (!found.access.canEdit) throw new ReadOnly();
    rememberUser(id, user);
    return found;
  };
  const loadForEdit = async (id: string, user: User | null) => (await editable(id, user)).session;

  /** Refuses an action while the session works, for one that changes it at once and starts no model work. */
  const startAction = (session: Session) => {
    if (claims.has(session.id)) throw new InvalidStateError("This session is already working. Wait for it to finish.", "session_busy");
  };

  /**
   * Starts a revision of a session's verdict for the caller who may change it: recorded at once, then made in the
   * background (the arbiter only, and a short critique when needed). The host hears when it starts and how it ends;
   * `onMade` runs once the new verdict exists.
   */
  const startRevision = async (
    session: Session,
    request: Omit<RevisionRequest, "by">,
    onMade: (number: number) => Promise<void> = async () => {},
  ): Promise<PendingRevision> =>
    withClaim(session, async (held) => {
      if (session.phase !== "complete" || !session.verdict) throw new InvalidStateError("The verdict is not ready yet.");
      const user = users.get(session.id) ?? null;
      const number = (session.revisions.at(-1)?.number ?? 1) + 1;
      await authorize(session, { kind: "revision", number });
      const pending = await engineFor(session, held.controller.signal).beginRevision(session, { ...request, by: ownerOf(user) });
      const tell = async (status: RevisionEvent["status"]) => {
        if (!user || !hooks.onRevision || session.demo) return;
        await hooks.onRevision(user, session, { id: pending.id, number: pending.number, reason: pending.reason, status });
      };
      try {
        await tell("started");
      } catch (error) {
        pending.error = { code: "internal_error", message: "The revision could not start." };
        await store.save(session);
        throw error;
      }
      const cap = lowestCap(hooks.revisionBudgetUsd?.(session), hooks.maxBudgetUsd);
      runInBackground(session, held, async (engine) => {
        const made = await engine.runRevision(session, { budgetUsd: cap });
        if (made) await onMade(pending.number).catch((error: unknown) => console.error(`After revision ${pending.number}:`, error));
        await tell(made ? "completed" : "failed");
      });
      return pending;
    });

  app.get("/api/sessions/:id", async (c) => {
    const id = c.req.param("id");
    const user = c.get("user");
    const { session, owner, access } = await accessOf(id, user);
    if (!users.has(id) && access.mine) rememberUser(id, user);
    if (!access.mine && access.shared && hooks.authors && owner) access.author = (await hooks.authors([owner]))[owner] ?? null;
    return c.json({
      session: view(session),
      // The build cost of each option priced from its work packages, and how it fits the budget and the deadline, for
      // the current revision (an adopted scenario has numbers of its own).
      costings: sessionCostings(currentView(session)),
      checks: deliveryChecks(currentView(session)),
      busy: claims.has(id),
      share: await store.shareOf(id),
      feedback: await store.feedbackOf(id),
      price: session.demo ? null : await priceOf(user, session, session.id),
      // What the next revision of the verdict costs, shown on the button that makes it.
      revisionPrice: session.demo || !session.verdict || !access.canEdit ? null : await priceOf(user, session, session.id, "revision"),
      providerCosts: !hooks.hideProviderCosts,
      access,
    });
  });

  // A revision of the verdict from facts the person states: corrections, answers received another way.
  app.post("/api/sessions/:id/revisions", async (c) => {
    const session = await loadForEdit(c.req.param("id"), c.get("user"));
    const input = RevisionInput.parse(await c.req.json());
    if (input.facts.length === 0 && !input.note) throw new InvalidStateError("State at least one new fact.", "no_answers");
    const pending = await startRevision(session, {
      reason: "edit",
      inputs: { facts: input.facts, note: input.note, questionnaireId: null },
    });
    return c.json({ accepted: true, revision: pending.number }, 202);
  });

  app.delete("/api/sessions/:id", async (c) => {
    const { session, owner } = await editable(c.req.param("id"), c.get("user"));
    return withClaim(session, async () => {
      await store.delete(session.id, owner);
      users.delete(session.id);
      return c.body(null, 204);
    });
  });

  // Hides a session from the other members of its workspace, or shares it with them again: its author only.
  app.put("/api/sessions/:id/visibility", async (c) => {
    const { session, access } = await accessOf(c.req.param("id"), c.get("user"));
    if (!access.mine) throw new ReadOnly("Only the author of this session can change who sees it.");
    const { private: isPrivate } = z.object({ private: z.boolean() }).parse(await c.req.json());
    await store.setPrivate(session.id, isPrivate);
    return c.json({ access: { ...access, private: isPrivate } });
  });

  app.post("/api/sessions/:id/interview", async (c) => {
    const session = await loadForEdit(c.req.param("id"), c.get("user"));
    return withClaim(session, async (held) => {
      const { answers } = z.object({ answers: AnswerList }).parse(await c.req.json());
      if (session.phase !== "interview") throw new InvalidStateError("The interview is over.");
      await authorize(session);
      runInBackground(session, held, (engine) => engine.answerInterview(session, answers));
      return c.json({ accepted: true }, 202);
    });
  });

  app.put("/api/sessions/:id/sheet", async (c) => {
    const session = await loadForEdit(c.req.param("id"), c.get("user"));
    return withClaim(session, async (held) => {
      const { sheet, ignoreProfile } = z
        .object({ sheet: RequirementsSheet, ignoreProfile: z.boolean().optional() })
        .parse(await c.req.json());
      await authorize(session);
      await engineFor(session, held.controller.signal).confirmSheet(session, sheet, ignoreProfile === undefined ? {} : { ignoreProfile });
      runInBackground(session, held, (engine) => engine.runDebate(session));
      return c.json({ accepted: true }, 202);
    });
  });

  app.post("/api/sessions/:id/answers", async (c) => {
    const session = await loadForEdit(c.req.param("id"), c.get("user"));
    return withClaim(session, async (held) => {
      const { answers } = z.object({ answers: AnswerList }).parse(await c.req.json());
      await authorize(session);
      await engineFor(session, held.controller.signal).answerDebate(session, answers);
      runInBackground(session, held, (engine) => engine.runDebate(session));
      return c.json({ accepted: true }, 202);
    });
  });

  // Retries the step a failed session stopped on. `budgetUsd` sets a new cost cap first (null for none), within the
  // host's caps; a host that keeps provider costs to itself keeps each debate's cap fixed.
  app.post("/api/sessions/:id/resume", async (c) => {
    const session = await loadForEdit(c.req.param("id"), c.get("user"));
    return withClaim(session, async (held) => {
      const { budgetUsd } = ResumeInput.parse(await c.req.json().catch(() => ({})));
      if (session.phase !== "failed") throw new InvalidStateError("Only a failed session can be resumed.");
      let cap: number | null | undefined;
      if (budgetUsd !== undefined) {
        if (hooks.hideProviderCosts) throw new InvalidStateError("This server sets the cost cap of each debate.", "budget_fixed");
        cap = lowestCap(budgetUsd, hooks.maxBudgetUsd, hooks.sessionBudgetUsd?.(session));
      }
      await authorize(session);
      runInBackground(session, held, async (engine) => {
        const next = await engine.resume(session, cap === undefined ? {} : { budgetUsd: cap });
        if (next === "debate" && session.phase === "debating") await engine.runDebate(session);
      });
      return c.json({ accepted: true, ...(cap === undefined ? {} : { budgetUsd: cap }) }, 202);
    });
  });

  // Stops the work in flight: the model calls are cancelled, nothing more is spent, and the session fails with the
  // code "stopped", ready to be resumed. Answers once the work has stopped, with the session as it was left.
  app.post("/api/sessions/:id/stop", async (c) => {
    const session = await loadForEdit(c.req.param("id"), c.get("user"));
    const worker = claims.get(session.id);
    if (!worker?.background) throw new InvalidStateError("This session is not running.", "not_running");
    worker.controller.abort();
    await worker.done;
    return c.json({ session: view(session) });
  });

  // The verdict rewritten for another reader. Short enough to wait for.
  app.post("/api/sessions/:id/brief", async (c) => {
    const { session, access } = await accessOf(c.req.param("id"), c.get("user"));
    return withClaim(session, async (held) => {
      const { audience } = z.object({ audience: Audience }).parse(await c.req.json());
      const cached = session.briefs[audience];
      if (cached) return c.json({ brief: cached });
      // Writing a new one calls a model: for those who may change the session.
      if (!access.canEdit) throw new ReadOnly();
      rememberUser(session.id, c.get("user"));
      await authorize(session);
      await engineFor(session, held.controller.signal).writeBrief(session, audience);
      return c.json({ brief: session.briefs[audience] });
    });
  });

  // Starts a new session from an earlier one, at the requirements review: the person
  // changes what moved in their project and runs the debate again.
  app.post("/api/sessions/:id/fork", async (c) => {
    const user = c.get("user");
    const { session: source, private: isPrivate } = await accessOf(c.req.param("id"), user);
    if (!source.sheet) throw new InvalidStateError("This session has no requirements sheet yet.");
    const session = createSession({
      locale: source.locale,
      idea: source.idea,
      demo: source.demo,
      mode: source.mode,
      template: source.template,
      complianceTemplates: source.complianceTemplates,
      // The new debate checks the facts on the web again, with the same limits: its own sources, of its own day.
      webResearch: source.webResearch,
      depth: source.depth,
      rounds: Math.min(source.rounds, MAX_ROUNDS),
      budgetUsd: source.budgetUsd,
      interviewer: source.interviewer,
      arbiter: source.arbiter,
      seats: source.seats,
      devil: source.devil,
      challenge: source.challenge,
      audit: source.audit ? { documentIds: source.audit.documentIds, alternative: source.audit.alternative } : null,
      context: source.context,
      redact: source.redact,
      notify: source.notify,
      parentId: source.id,
    });
    // A European-only decision stays so, and a workspace that now requires it applies it to the new debate.
    if (!source.demo && (source.european || (await europeanPolicyOf(user)) === "required")) {
      session.european = europeanSession(source, await catalogFor(user), envFor(user)).european;
    }
    session.interview = structuredClone(source.interview);
    // The requirements of the decision as it stands: an adopted scenario's, with its changes.
    session.sheet = structuredClone(currentView(source).sheet);
    session.phase = "review";
    // The new debate follows the profile in force now, not the one the earlier decision was made with.
    session.profile = await profileFor(user, session);
    rememberUser(session.id, user);
    // In the caller's workspace, whoever started the original; a private session's copy stays private.
    const workspace = (await scopeOf(user))?.workspace ?? null;
    await store.save(session, ownerOf(user), { workspace, private: isPrivate && workspace !== null });
    return c.json({ session: view(session) }, 201);
  });

  // Creates the share link of a session, or changes it: a field left out keeps its value. A new link shows the client
  // deliverable for 30 days, without a password.
  app.post("/api/sessions/:id/share", async (c) => {
    const session = await loadForEdit(c.req.param("id"), c.get("user"));
    const input = ShareInput.parse(await c.req.json());
    const existing = await store.shareOf(session.id);
    const expiresIn = input.expiresIn ?? (existing ? undefined : "30d");
    const days = expiresIn === undefined ? undefined : SHARE_EXPIRIES[expiresIn];
    const settings: ShareSettings = {
      public: input.public,
      mode: input.mode ?? (existing ? undefined : "client"),
      expiresAt: days === undefined ? undefined : days === null ? null : new Date(Date.now() + days * 86_400_000).toISOString(),
      passwordHash: input.password === undefined ? undefined : input.password === null ? null : await hashPassword(input.password),
    };
    const share = await store.share(session.id, settings);
    if (share.mode === "client") void writeClientBrief(session);
    return c.json({ share });
  });

  app.delete("/api/sessions/:id/share", async (c) => {
    const session = await loadForEdit(c.req.param("id"), c.get("user"));
    await store.unshare(session.id);
    return c.body(null, 204);
  });

  /**
   * The session behind a share link, when the link still works and the visitor may open it: a protected link needs
   * the access token its password gives (X-Share-Access header, or ?access= for a download link).
   */
  const openShare = async (c: Context) => {
    const token = c.req.param("token") ?? "";
    const found = await store.shared(token);
    if (!found) throw new NotFound();
    const { share } = found;
    if (share.expiresAt !== null && Date.parse(share.expiresAt) <= Date.now()) throw new ShareRefused(410, "share_expired");
    if (share.passwordHash !== null) {
      const access = c.req.header("x-share-access") ?? c.req.query("access");
      if (!validAccess(access, share.token, share.passwordHash)) throw new ShareRefused(401, "password_required");
    }
    return found;
  };
  const shareInfo = (share: StoredShare) => ({ mode: share.mode, expiresAt: share.expiresAt, hasPassword: share.hasPassword });

  app.get("/api/shared/:token", async (c) => {
    const { session, share } = await openShare(c);
    if (share.mode === "full") return c.json({ share: shareInfo(share), session: publicView(session) });
    retryClientBrief(session);
    return c.json({ share: shareInfo(share), deliverable: clientDeliverable(currentView(session)) });
  });

  app.get("/api/shared/:token/report.md", async (c) => {
    const { session, share } = await openShare(c);
    if (share.mode === "full") return markdown(c, currentView(publicView(session)));
    c.header("Content-Type", "text/markdown; charset=utf-8");
    c.header("Content-Disposition", `attachment; filename="${slug(session)}-report.md"`);
    return c.body(renderClientReport(clientDeliverable(currentView(session))));
  });

  // The password of a protected link, for an access token valid a few hours. Attempts are counted per link and per
  // caller, before the password is checked.
  app.post("/api/shared/:token/access", async (c) => {
    const token = c.req.param("token");
    const found = await store.shared(token);
    if (!found) throw new NotFound();
    const { share } = found;
    if (share.expiresAt !== null && Date.parse(share.expiresAt) <= Date.now()) throw new ShareRefused(410, "share_expired");
    if (share.passwordHash === null) return c.json({ access: null, expiresAt: null });
    const caller = clientAddress(c, proxies);
    const { password } = AccessInput.parse(await c.req.json());
    const checked = await passwords.check(token, caller, password, share.passwordHash);
    if (checked === "limited") throw new ShareRefused(429, "too_many_attempts");
    if (checked === "wrong") throw new ShareRefused(401, "wrong_password");
    return c.json(accessToken(share.token, share.passwordHash));
  });

  app.get("/api/gallery", async (c) => c.json({ sessions: await store.gallery() }));

  app.post("/api/sessions/:id/feedback", async (c) => {
    const session = await load(c.req.param("id"), c.get("user"));
    const input = z
      .object({
        helpful: z.boolean().nullable().default(null),
        kind: z.enum(["rating", "error"]).default("rating"),
        comment: z.string().trim().max(2_000).default(""),
      })
      .parse(await c.req.json());
    await store.addFeedback({ sessionId: session.id, ...input, createdAt: new Date().toISOString() });
    return c.json({ feedback: await store.feedbackOf(session.id) }, 201);
  });

  // Everything stored about the caller, in one file: the GDPR right to data portability.
  app.get("/api/export", async (c) => {
    const sessions = await store.all(ownerOf(c.get("user")));
    const exported = [];
    for (const session of sessions) {
      exported.push({
        ...view(session),
        share: await store.shareOf(session.id),
        feedback: await store.feedbackOf(session.id),
        questionnaires: (await store.questionnairesOf(session.id)).map(publicQuestionnaire),
      });
    }
    c.header("Content-Disposition", `attachment; filename="quorumind-export-${new Date().toISOString().slice(0, 10)}.json"`);
    return c.json({ exportedAt: new Date().toISOString(), sessions: exported });
  });

  // ?revision=N: the report of an earlier revision of the verdict.
  app.get("/api/sessions/:id/report.md", async (c) => {
    const session = await load(c.req.param("id"), c.get("user"));
    const revision = c.req.query("revision");
    const shown = revision ? sessionAtRevision(session, Number(revision)) : currentView(session);
    if (!shown) throw new NotFound();
    return markdown(c, shown);
  });

  app.get("/api/sessions/:id/events", async (c) => {
    const session = await load(c.req.param("id"), c.get("user"));
    return streamSSE(c, async (stream) => {
      let id = 0;
      const queue: string[] = [];
      let wake: (() => void) | null = null;
      const unsubscribe = bus.subscribe(session.id, (event) => {
        queue.push(JSON.stringify(event.type === "session" ? { ...event, session: view(event.session) } : event));
        wake?.();
      });
      stream.onAbort(() => {
        unsubscribe();
        wake?.();
      });
      await stream.writeSSE({ id: String(id++), event: "message", data: JSON.stringify({ type: "session", session: view(session) }) });
      while (!stream.aborted) {
        const next = queue.shift();
        if (next !== undefined) {
          await stream.writeSSE({ id: String(id++), event: "message", data: next });
          continue;
        }
        let timer: ReturnType<typeof setTimeout> | undefined;
        await new Promise<void>((resolve) => {
          wake = resolve;
          timer = setTimeout(resolve, 15_000);
        });
        // Woken by an event: the keep-alive timer of this wait is no longer needed.
        clearTimeout(timer);
        wake = null;
        if (queue.length === 0 && !stream.aborted) await stream.writeSSE({ event: "ping", data: "" });
      }
      unsubscribe();
    });
  });

  // The client answered a questionnaire: the agency hears it by e-mail when the server sends mail, in its chat channel
  // when it has one, and through the host's hook.
  const answered = async (found: StoredSession, questionnaire: StoredQuestionnaire) => {
    const owner = found.owner ? { userId: found.owner } : null;
    if (deps.chat) await deps.chat.notify(found.session, "answers_received", found);
    if (deps.notifier) {
      const recipient = owner && hooks.notifyRecipient ? await hooks.notifyRecipient(owner) : null;
      if (recipient || !hooks.identify) await deps.notifier.notify(found.session, "answers_received", recipient);
    }
    await hooks.onQuestionnaireSubmitted?.(owner, found.session, publicQuestionnaire(questionnaire));
  };

  app.route("/", contextRoutes({ env }));
  app.route("/", profileRoutes({ branding: settings, ownerOf, hosted: Boolean(hooks.profile) }));
  app.route(
    "/",
    questionnaireRoutes({
      store,
      branding: settings,
      readable: load,
      editable,
      revise: async (session, { inputs }, onMade) => startRevision(session, { reason: "client_answers", inputs }, onMade),
      answered,
      callerOf: (c) => clientAddress(c, proxies),
    }),
  );
  app.route(
    "/",
    exportRoutes({
      getSession: (id, user) =>
        load(id, user).catch((error: unknown) => {
          if (error instanceof NotFound) return null;
          throw error;
        }),
      ownerOf,
      branding: settings,
    }),
  );

  const decisionDeps = {
    store,
    hooks,
    access: accessOf,
    editable,
    startAction,
    revise: (session: Session, request: Omit<RevisionRequest, "by">) => startRevision(session, request),
    publish: (session: Session) => bus.publish(session.id, { type: "session", session }),
    ownerOf,
    scopeOf,
    notifier: deps.notifier ?? null,
    chat: deps.chat ?? null,
    publicUrl: deps.publicUrl ?? null,
  };
  app.route("/", decisionRoutes(decisionDeps));

  app.notFound((c) => c.json({ error: "not_found" }, 404));
  app.onError((error, c) => {
    // MissingSession: deleted while the request was on its way.
    if (error instanceof NotFound || error instanceof MissingSession) {
      return c.json({ error: "not_found", message: "This session does not exist." }, 404);
    }
    if (error instanceof ReadOnly) return c.json({ error: "read_only", message: error.message }, 403);
    if (error instanceof InvalidStateError) {
      return c.json({ error: error.code, message: error.message, ...(error.params ? { params: error.params } : {}) }, 409);
    }
    if (error instanceof InvalidLineup) {
      return c.json({ error: "invalid_lineup", message: error.message, ...(error.model ? { params: { model: error.model } } : {}) }, 400);
    }
    if (error instanceof NonEuropeanModel) {
      return c.json({ error: error.code, message: error.message, params: { model: error.model } }, 400);
    }
    if (error instanceof EuropeanUnavailable) return c.json({ error: error.code, message: error.message }, 400);
    if (error instanceof PaymentRequired) return c.json({ error: error.code, message: error.message }, 402);
    if (error instanceof ProviderUnavailable) {
      console.error(error.cause);
      return c.json({ error: "provider_unavailable", message: error.message }, 503);
    }
    if (error instanceof ShareRefused) return c.json({ error: error.code, message: error.message }, error.status);
    if (error instanceof z.ZodError) return c.json(invalidRequest(error), 400);
    if (error instanceof SyntaxError) return c.json({ error: "invalid_request", message: "The body is not valid JSON." }, 400);
    console.error(error);
    return c.json({ error: "internal_error", message: "Something went wrong on the server." }, 500);
  });

  /**
   * Interrupts every session working in this process, for a server that is shutting down: the calls in flight are
   * cancelled, nothing more is spent, and each session fails with the code "interrupted", ready to be resumed.
   */
  const interruptAll = async () => {
    draining = true;
    const running = [...claims.values()];
    for (const held of running) held.controller.abort(INTERRUPTED);
    await Promise.all(running.map((held) => held.done));
    return running.filter((held) => held.background).length;
  };

  /** Sends the reminders of the decisions whose review date has come: run daily (hourly on the hosted version). */
  const sendReminders = (now?: Date) => sendReviewReminders(decisionDeps, now);

  /** Whether some work on this session is in progress in this process (its claim is held). */
  const isRunning = (sessionId: string) => claims.has(sessionId);

  return Object.assign(app, { interruptAll, sendReminders, isRunning });
}

function markdown(c: { header(name: string, value: string): void; body(data: string): Response }, session: Session) {
  c.header("Content-Type", "text/markdown; charset=utf-8");
  c.header("Content-Disposition", `attachment; filename="${slug(session)}-report.md"`);
  return c.body(renderReport(session));
}

export function retentionDays(env: Env): number | null {
  const days = Number(env.QUORUMIND_RETENTION_DAYS);
  return Number.isFinite(days) && days > 0 ? days : null;
}

/** Seats must be consecutive from A, two to four of them, and every model must be in the catalog. */
function validateLineup(input: z.infer<typeof LineupInput>, catalog: ModelOption[]): Lineup {
  const known = (participant: { provider: string; model: string }): Participant => {
    const option = catalog.find((entry) => entry.provider === participant.provider && entry.model === participant.model);
    if (!option)
      throw new InvalidLineup(
        `The model ${participant.provider}:${participant.model} is not available on this server.`,
        `${participant.provider}:${participant.model}`,
      );
    return { provider: option.provider, model: option.model };
  };
  const keys = Object.keys(input.seats).sort();
  if (keys.length < 2 || keys.join("") !== PROPOSER_SEATS.slice(0, keys.length).join("")) {
    throw new InvalidLineup("A debate needs two to four seats, named from A.");
  }
  return {
    interviewer: known(input.interviewer),
    arbiter: known(input.arbiter),
    seats: Object.fromEntries(
      keys.map((key) => [key, { ...known(input.seats[key as "A"] as Participant), persona: input.seats[key as "A"]?.persona ?? null }]),
    ),
    devil: input.devil ? { ...known(input.devil), persona: input.devil.persona } : null,
  };
}

/** The hosted catalog's default: the first two makers face each other, the first model rules. */
function defaultLineup(catalog: ModelOption[]): Lineup | null {
  const first = catalog[0];
  if (!first) return null;
  const second = catalog.find((entry) => makerOf(entry) !== makerOf(first)) ?? first;
  const pick = (option: ModelOption): Participant => ({ provider: option.provider, model: option.model });
  return {
    interviewer: pick(first),
    arbiter: pick(first),
    seats: { A: { ...pick(first), persona: null }, B: { ...pick(second), persona: null } },
    devil: null,
  };
}

class NotFound extends Error {}
/** A member of the session's workspace who may read it, not change it. */
class ReadOnly extends Error {
  constructor(message = "Only the author of this session or an admin of its workspace can change it.") {
    super(message);
  }
}
class InvalidLineup extends Error {
  /** The model that is not available, as provider:model; null when the seats are wrong. */
  readonly model: string | null;
  constructor(message: string, model: string | null = null) {
    super(message);
    this.model = model;
  }
}
/** A share link that does not open: expired (410), protected (401) or asked too many wrong passwords (429). */
class ShareRefused extends Error {
  readonly status: 401 | 410 | 429;
  readonly code: "share_expired" | "password_required" | "wrong_password" | "too_many_attempts";
  constructor(status: ShareRefused["status"], code: ShareRefused["code"]) {
    super(SHARE_REFUSALS[code]);
    this.status = status;
    this.code = code;
  }
}

const SHARE_REFUSALS = {
  share_expired: "This share link has expired.",
  password_required: "This share link is protected by a password.",
  wrong_password: "The password is not right.",
  too_many_attempts: "Too many wrong passwords. Wait a few minutes and try again.",
} as const;

/** A model of the session cannot be called from this server: its SDK refused to start, without an API key for instance. */
class ProviderUnavailable extends Error {
  constructor(cause: unknown) {
    super(`A model of this session cannot be reached from this server: ${cause instanceof Error ? cause.message : String(cause)}`, {
      cause,
    });
  }
}

/**
 * What an action holds on a session while it works (createApp's claim). `background` is set once a worker took the
 * work over; `controller` cancels its model calls (POST /stop, shutdown); `done` resolves once it is released.
 */
interface Claim {
  readonly controller: AbortController;
  background: boolean;
  readonly done: Promise<void>;
  release(): void;
}

class PaymentRequired extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
