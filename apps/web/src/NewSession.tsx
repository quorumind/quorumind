import type { ContextDocument, Depth, Lineup, Mode, ModelOption } from "@quorumind/core";
import type { ComplianceTemplateId } from "@quorumind/core/compliance";
import type { Locale } from "@quorumind/core/locales";
import { europeanCatalog } from "@quorumind/core/sovereignty";
import type { TemplateId } from "@quorumind/core/templates";
import { type FormEvent, type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { navigate, replaceRoute, useSessions } from "./App.tsx";
import { ApiError, type AppConfig, api, MAX_BUDGET_USD, type PriceQuote } from "./api.ts";
import { capOf, capRange, MIN_BUDGET_USD } from "./budget.ts";
import { BusyButton } from "./components/BusyButton.tsx";
import { CompliancePicker, EuropeanToggle } from "./components/ComplianceOptions.tsx";
import { ContextPicker } from "./components/ContextPicker.tsx";
import { Switch } from "./components/Controls.tsx";
import { CharCounter, FieldError, fieldProps, serverField, useFieldErrors } from "./components/Field.tsx";
import { ArrowIcon, AuditIcon, BoltIcon, CheckIcon, CompareIcon, LocalIcon, PlayIcon, TargetIcon } from "./components/Icons.tsx";
import { Skeleton } from "./components/Logo.tsx";
import { consumeNavigation, PageHead } from "./components/Page.tsx";
import { keyOf, LineupEditor, modelInfo, PanelSummary } from "./components/Panel.tsx";
import { failureText } from "./errors.ts";
import { formatPrice, formatUsd } from "./format.ts";
import { sendOnShortcut } from "./formKeys.ts";

// A new session in four steps: the need, its context, the panel of models, then a summary to launch from. Every step
// stays mounted (hidden when it is not the current one), so an import running on one step goes on while the person
// moves to the next, and nothing typed is lost going back and forth.

const MODES: Mode[] = ["standard", "express", "challenge", "audit"];
const MODE_ICONS = { standard: CompareIcon, express: BoltIcon, challenge: TargetIcon, audit: AuditIcon } as const;
const DEPTHS: Depth[] = ["quick", "standard", "deep"];
const ROUNDS = [1, 2, 3] as const;
const ROUND_KEYS = { 1: "one", 2: "two", 3: "three" } as const;
const STEPS = ["need", "context", "panel", "review"] as const;
type Step = (typeof STEPS)[number];
export const isWizardStep = (value: unknown): value is Step => STEPS.includes(value as Step);
/** The address of a step: the first one is the home page, each next one has its own, for the browser's Back. */
const stepPath = (step: Step) => (step === "need" ? "" : `new/${step}`);
const DRAFT_KEY = "quorumind.newSession";
/** The server's names for what it refuses in a new debate, with the step and the field that show it. */
const SERVER_FIELDS: Record<string, { step: Step; field: string }> = {
  idea: { step: "need", field: "idea" },
  challenge: { step: "need", field: "solution" },
  budgetUsd: { step: "review", field: "budget" },
};
const DEMO_BUTTON_ID = "demo-start";

/** What the form keeps across a reload of the tab: the choices, not the documents (they can be large). */
interface Draft {
  step: Step;
  mode: Mode;
  idea: string;
  solution: string;
  template: TemplateId | null;
  complianceTemplates: ComplianceTemplateId[];
  europeanOnly: boolean | null;
  lineup: Lineup | null;
  depth: Depth;
  rounds: number;
  budget: string;
  redact: boolean;
  webResearch: boolean | null;
  notify: boolean;
  alternative: boolean;
  /** How many documents were attached: only to say, after a reload, that they have to be added again. */
  documents: number;
}

function readDraft(): Partial<Draft> {
  try {
    const stored = sessionStorage.getItem(DRAFT_KEY);
    const draft = stored ? (JSON.parse(stored) as unknown) : null;
    return draft && typeof draft === "object" ? (draft as Partial<Draft>) : {};
  } catch {
    return {};
  }
}

function saveDraft(draft: Draft | null) {
  try {
    if (draft) sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    else sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // Without storage, a reload starts the form again.
  }
}

/** Whether a lineup kept from an earlier visit can still be played: every model in it is still offered. */
function playable(lineup: Lineup | null | undefined, catalog: ModelOption[]): lineup is Lineup {
  if (!lineup || typeof lineup !== "object" || !lineup.seats || !lineup.arbiter || !lineup.interviewer) return false;
  const participants = [lineup.interviewer, lineup.arbiter, ...Object.values(lineup.seats), ...(lineup.devil ? [lineup.devil] : [])];
  return Object.keys(lineup.seats).length >= 2 && participants.every((one) => catalog.some((option) => keyOf(option) === keyOf(one)));
}

/** One choice among a few, each with what it changes: radio buttons drawn as cards. */
function ChoiceCards<T extends string | number>({
  name,
  legend,
  lead,
  options,
  value,
  onChange,
  disabled,
}: {
  name: string;
  legend: string;
  /** A line under the legend: what the choice is for. */
  lead?: string;
  options: { value: T; label: string; hint: string }[];
  value: T;
  onChange: (next: T) => void;
  disabled?: boolean;
}) {
  const leadId = useId();
  return (
    <fieldset className="choice-group" disabled={disabled} aria-describedby={lead ? leadId : undefined}>
      <legend className="field-label">{legend}</legend>
      {lead ? (
        <p className="field-hint choice-lead" id={leadId}>
          {lead}
        </p>
      ) : null}
      <div className="choice-cards">
        {options.map((option) => (
          <label key={option.value} className="choice-card" data-checked={option.value === value}>
            <input type="radio" name={name} checked={option.value === value} onChange={() => onChange(option.value)} />
            <span className="choice-name">{option.label}</span>
            <span className="choice-hint">{option.hint}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Where the person is in the four steps; a step already reached can be opened again. */
function Stepper({ step, reachable, onOpen }: { step: Step; reachable: (target: Step) => boolean; onOpen: (target: Step) => void }) {
  const { t } = useTranslation();
  const current = STEPS.indexOf(step);
  return (
    <nav aria-label={t("wizard.stepsLabel")}>
      <ol className="stepper">
        {STEPS.map((name, index) => {
          const state = index < current ? "done" : index === current ? "current" : "todo";
          const content = (
            <>
              <span className="stepper-mark" aria-hidden="true">
                {state === "done" ? <CheckIcon /> : index + 1}
              </span>
              <span className="stepper-name">{t(`wizard.steps.${name}`)}</span>
            </>
          );
          return (
            <li key={name} data-state={state} aria-current={state === "current" ? "step" : undefined}>
              {state !== "current" && reachable(name) ? (
                <button type="button" className="stepper-link" onClick={() => onOpen(name)}>
                  {content}
                </button>
              ) : (
                <span className="stepper-link">{content}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * `step`: the step in the address (none for the home page). Opened afresh on the home page, the form goes back to the
 * step a draft reached. `demo`: the page was opened to watch the recorded demo (#/?demo=1), whose offer comes first.
 */
export function NewSession({
  step: routeStep,
  moves = 0,
  demo = false,
}: {
  step?: string | undefined;
  moves?: number;
  demo?: boolean;
} = {}) {
  const { t, i18n } = useTranslation();
  const { refresh } = useSessions();
  const [draft] = useState(readDraft);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [opened] = useState<Step>(() => (isWizardStep(routeStep) ? routeStep : isWizardStep(draft.step) ? draft.step : "need"));
  const [step, setStep] = useState<Step>(opened);
  // The step the home page's address stands for: the draft's on opening, the first step once the person moved.
  const home = useRef<Step>(routeStep === undefined ? opened : "need");
  const lastRoute = useRef(routeStep);
  const lastMoves = useRef(moves);
  const [furthest, setFurthest] = useState(STEPS.indexOf(step));
  const [mode, setMode] = useState<Mode>(draft.mode && MODES.includes(draft.mode) ? draft.mode : "standard");
  const [idea, setIdea] = useState(typeof draft.idea === "string" ? draft.idea : "");
  const [solution, setSolution] = useState(typeof draft.solution === "string" ? draft.solution : "");
  const [template, setTemplate] = useState<TemplateId | null>(draft.template ?? null);
  const [complianceTemplates, setComplianceTemplates] = useState<ComplianceTemplateId[]>(
    Array.isArray(draft.complianceTemplates) ? draft.complianceTemplates : [],
  );
  const [europeanOnly, setEuropeanOnly] = useState(false);
  const [context, setContext] = useState<ContextDocument[]>([]);
  // The draft keeps the choices but not the documents: after a reload, the person is told which ones are gone.
  const [documentsLost, setDocumentsLost] = useState(typeof draft.documents === "number" && draft.documents > 0);
  // Audit mode: every attached document is under audit unless the person marks it as background.
  const [background, setBackground] = useState<string[]>([]);
  const [alternative, setAlternative] = useState(draft.alternative === true);
  const [lineup, setLineup] = useState<Lineup | null>(null);
  const [depth, setDepth] = useState<Depth>(draft.depth && DEPTHS.includes(draft.depth) ? draft.depth : "standard");
  const [rounds, setRounds] = useState(ROUNDS.includes(draft.rounds as 1) ? (draft.rounds as number) : 1);
  const [budget, setBudget] = useState(typeof draft.budget === "string" && !capOf(draft.budget).invalid ? draft.budget : "");
  const [budgetBad, setBudgetBad] = useState(false);
  const [redact, setRedact] = useState(draft.redact === true);
  // Null follows the default of the server (or of the price tier) for these settings, until the person ticks or unticks it.
  const [webResearch, setWebResearch] = useState<boolean | null>(typeof draft.webResearch === "boolean" ? draft.webResearch : null);
  const [researchDefault, setResearchDefault] = useState(false);
  const [notify, setNotify] = useState(draft.notify === true);
  const [estimate, setEstimate] = useState<{ low: number; high: number } | null>(null);
  const [price, setPrice] = useState<PriceQuote | null>(null);
  // The host would refuse this lineup: its usual cost is over the cap included in the debate's price.
  const [overCap, setOverCap] = useState(false);
  const [pending, setPending] = useState<"live" | "demo" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fields = useFieldErrors();
  const [editorOpen, setEditorOpen] = useState(false);
  const [profile, setProfile] = useState<"none" | "set" | "workspace" | null>(null);
  // Starting while a document is still being imported would leave it out of the session.
  const [importing, setImporting] = useState(false);
  const headings = useRef<Partial<Record<Step, HTMLHeadingElement | null>>>({});
  const editorToggle = useRef<HTMLButtonElement>(null);
  const moved = useRef(false);

  useEffect(() => {
    api.config().then(
      (loaded) => {
        setConfig(loaded);
        const required = loaded.european?.policy === "required";
        const european = Boolean(loaded.european?.policy && loaded.european.lineup);
        const chosen = required || (typeof draft.europeanOnly === "boolean" && loaded.european ? draft.europeanOnly : european);
        setEuropeanOnly(chosen);
        const defaults = (chosen ? loaded.european?.lineup : null) ?? loaded.live?.lineup ?? null;
        const catalog = chosen ? europeanCatalog(loaded.catalog) : loaded.catalog;
        setLineup(playable(draft.lineup, catalog) ? draft.lineup : defaults);
        if (loaded.profileSettings === false) setProfile("workspace");
        else
          api.profile().then(
            (body) => setProfile(body.profile ? "set" : "none"),
            () => undefined,
          );
      },
      () => setError(t("error.request")),
    );
  }, [t, draft]);

  // The choices are kept for a reload of the tab, until the session starts.
  useEffect(() => {
    if (!config) return;
    saveDraft({
      step,
      mode,
      idea,
      solution,
      template,
      complianceTemplates,
      europeanOnly,
      lineup,
      depth,
      rounds,
      budget,
      redact,
      webResearch,
      notify,
      alternative,
      documents: context.length,
    });
  }, [
    config,
    context.length,
    step,
    mode,
    idea,
    solution,
    template,
    complianceTemplates,
    europeanOnly,
    lineup,
    depth,
    rounds,
    budget,
    redact,
    webResearch,
    notify,
    alternative,
  ]);

  // Each step opened by the person takes the focus on its heading, for screen readers.
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    headings.current[step]?.focus();
  }, [step]);

  // Opened to watch the recorded demo: its button takes the focus once it is there, and waits to be pressed.
  const demoFocused = useRef(false);
  useEffect(() => {
    if (!demo || !config || demoFocused.current) return;
    demoFocused.current = true;
    document.getElementById(DEMO_BUTTON_ID)?.focus();
  }, [demo, config]);

  // The address says the step shown: a draft resumed on the home page rewrites it in place, so that Back from the
  // next step comes back here rather than to the first step.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, for the step the page opened on.
  useEffect(() => {
    if (routeStep !== undefined && routeStep !== "need") return;
    if (step === "need") return;
    const query = window.location.hash.includes("?") ? window.location.hash.slice(window.location.hash.indexOf("?")) : "";
    replaceRoute(`${stepPath(step)}${query}`);
  }, []);

  const effectiveRounds = mode === "express" ? 1 : rounds;
  // A European-only debate never searches: no search engine keeps the queries in Europe.
  const researchAvailable = Boolean(config?.research?.kind) && !europeanOnly;
  const researchOn = researchAvailable && (webResearch ?? researchDefault);
  // Until the person ticks or unticks it, the research is left to the server's default for these settings, both for
  // the estimate and for the session: a default not known yet is never sent as "no research".
  const researchChoice = webResearch === null ? undefined : researchOn;
  const language = i18n.language as Locale;
  useEffect(() => {
    if (!lineup) return;
    let live = true;
    const timer = setTimeout(() => {
      api.estimate(lineup, effectiveRounds, mode, depth, language, mode === "audit" && alternative, researchChoice, europeanOnly).then(
        (body) => {
          // An answer to settings changed since is dropped: the estimate on screen is the latest one's.
          if (!live) return;
          setEstimate(body.estimateUsd);
          setPrice(body.price);
          setOverCap(body.overCap === true);
          if (body.research) setResearchDefault(body.research.default);
        },
        () => {
          if (!live) return;
          setEstimate(null);
          setPrice(null);
          setOverCap(false);
        },
      );
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [lineup, effectiveRounds, mode, depth, language, alternative, researchChoice, europeanOnly]);

  const allLocal = useMemo(() => {
    if (!config || !lineup) return false;
    const participants = [lineup.interviewer, lineup.arbiter, ...Object.values(lineup.seats), ...(lineup.devil ? [lineup.devil] : [])];
    return participants.every((participant) => config.catalog.find((option) => keyOf(option) === keyOf(participant))?.local);
  }, [config, lineup]);

  // The free demo model is the whole panel: its estimate is nothing because nothing is called.
  const allDemo = useMemo(() => {
    if (!lineup) return false;
    const participants = [lineup.interviewer, lineup.arbiter, ...Object.values(lineup.seats), ...(lineup.devil ? [lineup.devil] : [])];
    return participants.every((participant) => participant.provider === "mock");
  }, [lineup]);

  const live = config?.live ?? null;
  const audited = context.filter((document) => !background.includes(document.id)).map((document) => document.id);

  // A cap that is not an amount within the limits stops a live debate: it is never read as "no cap".
  const cap = capOf(budget, budgetBad);
  const range = capRange(i18n.language);
  const budgetError = fields.errors.budget ?? (cap.invalid ? t("common.budgetRange", range) : null);

  const start = async (demo: boolean) => {
    setPending(demo ? "demo" : "live");
    setError(null);
    try {
      const { session } = await api.create({
        locale: i18n.language as Locale,
        idea: demo ? "" : idea.trim(),
        demo,
        mode,
        // An audit starts from the document, not from a kind of project.
        template: mode === "audit" ? null : template,
        complianceTemplates: demo ? [] : complianceTemplates,
        europeanOnly: !demo && europeanOnly,
        ...(demo || researchChoice === undefined ? {} : { webResearch: researchChoice }),
        depth,
        rounds: effectiveRounds,
        budgetUsd: cap.amount,
        lineup: demo ? null : lineup,
        challenge: mode === "challenge" ? solution.trim() : null,
        audit: mode === "audit" && !demo ? { documentIds: audited, alternative } : null,
        context: demo ? [] : context,
        redact,
        notify,
      });
      if (!demo) saveDraft(null);
      refresh();
      navigate(`s/${session.id}`);
    } catch (caught) {
      const field = serverField(caught);
      const target = field ? SERVER_FIELDS[field] : undefined;
      if (target) {
        // The refused field belongs to a step: back there, with the message under it.
        const message = caught instanceof ApiError && caught.code === "invalid_request" ? t("validation.invalid") : failureText(t, caught);
        if (target.step !== step) open(target.step);
        setTimeout(() => fields.report({ [target.field]: message }), 0);
      } else setError(failureText(t, caught));
      setPending(null);
    }
  };

  // European models only: the lineup editor offers the European models, and the lineup starts from their default.
  const editorConfig = useMemo(
    () => (config && europeanOnly ? { ...config, catalog: europeanCatalog(config.catalog) } : config),
    [config, europeanOnly],
  );
  const defaults = (europeanOnly ? config?.european?.lineup : config?.live?.lineup) ?? config?.live?.lineup ?? null;
  const chooseEuropean = (next: boolean) => {
    setEuropeanOnly(next);
    setLineup((next ? config?.european?.lineup : config?.live?.lineup) ?? config?.live?.lineup ?? null);
  };

  const toggleAudited = (id: string) =>
    setBackground((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  const documents = (
    <>
      {documentsLost && context.length === 0 ? (
        <p className="notice" role="status">
          {t("setup.documentsLost")}{" "}
          <button type="button" className="button button-quiet" onClick={() => setDocumentsLost(false)}>
            {t("common.close")}
          </button>
        </p>
      ) : null}
      <ContextPicker
        value={context}
        onChange={setContext}
        disabled={!live}
        onBusyChange={setImporting}
        {...(mode === "audit"
          ? {
              title: t("setup.audit.documentsTitle"),
              lead: t("setup.audit.documentsLead"),
              marked: { label: t("setup.audit.audited"), ids: audited, onToggle: toggleAudited },
            }
          : {})}
      />
      <FieldError id="documents" error={fields.errors.documents} focusable />
    </>
  );

  // What keeps each step from going on, in words: the first thing missing.
  const missing: Record<Step, string | null> = {
    need: !live
      ? null
      : mode === "audit" && context.length === 0
        ? t("wizard.missingDocument")
        : mode === "audit" && audited.length === 0
          ? t("setup.audit.noneAudited")
          : !idea.trim()
            ? t(mode === "audit" ? "wizard.missingNeed" : "wizard.missingIdea")
            : mode === "challenge" && !solution.trim()
              ? t("wizard.missingSolution")
              : null,
    context: null,
    panel: null,
    review: importing ? t("setup.importing") : null,
  };
  // European models required with none on the server: the toggle says so, and no debate can start.
  const europeanBlocked = config?.european?.policy === "required" && !config.european.lineup;
  const valid: Record<Step, boolean> = {
    need: Boolean(live) && missing.need === null,
    context: true,
    panel: Boolean(lineup) && !europeanBlocked,
    review: !importing && !cap.invalid,
  };
  const ready = valid.need && valid.panel && !cap.invalid;
  const index = STEPS.indexOf(step);
  const reachable = (target: Step) => {
    const at = STEPS.indexOf(target);
    return at <= furthest && STEPS.slice(0, at).every((before) => valid[before]);
  };
  const open = (target: Step) => {
    moved.current = true;
    setStep(target);
    setFurthest((current) => Math.max(current, STEPS.indexOf(target)));
    // A new entry in the browser's history per step: its Back button (or a phone's back gesture) goes to the step
    // before, not out of the form. An address opened to watch the demo (?demo=1) is left behind on purpose: the person
    // chose the form, and the demo stays offered under it.
    if (target !== step) window.location.hash = `/${stepPath(target)}`;
  };
  // The first step a step needs done and is not: where an address to a later step lands instead.
  const firstMissing = (target: Step) => STEPS.slice(0, STEPS.indexOf(target)).find((before) => !valid[before]) ?? target;

  // The browser's Back and Forward move between the steps; an address to a step whose steps before it are not done
  // (typed, or kept from an earlier visit) opens the first one missing, in its place.
  // biome-ignore lint/correctness/useExhaustiveDependencies: follows the address, and the configuration once it comes.
  useEffect(() => {
    // Every move counts, even two that end where they started (Next, then Back before the page was drawn again).
    const previous = lastRoute.current;
    const travelled = previous !== routeStep || lastMoves.current !== moves;
    if (travelled) {
      lastRoute.current = routeStep;
      lastMoves.current = moves;
      home.current = "need";
      // The step's heading takes the focus below: the page's own heading must not take it at a later page.
      consumeNavigation();
    }
    if (!config) return;
    const wanted = isWizardStep(routeStep) ? routeStep : home.current;
    const target = firstMissing(wanted);
    if (target !== wanted) {
      // An address typed to a step not reachable yet: the entry it made is undone when it leads back to the step
      // shown before, so Back does not seem to do nothing; otherwise it is replaced. The steps after it are not
      // offered in the stepper as if they had been seen.
      if (travelled && moves > 0 && stepPath(target) === stepPath(isWizardStep(previous) ? previous : "need")) window.history.back();
      else replaceRoute(stepPath(target));
      setFurthest((current) => Math.min(current, STEPS.indexOf(target)));
    }
    if (target === step) return;
    moved.current = true;
    setStep(target);
  }, [routeStep, moves, config]);
  const next = STEPS[index + 1];

  // The first step does not grey out its buttons: it says under the field what is missing, and goes to it.
  const needsCheck = () => {
    if (missing.need === null) return true;
    const audit = mode === "audit" && (context.length === 0 || audited.length === 0);
    const name = audit ? "documents" : mode === "challenge" && idea.trim() ? "solution" : "idea";
    fields.report({ [name]: missing.need });
    return false;
  };
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (next) {
      if (step === "need" ? needsCheck() : valid[step]) open(next);
      return;
    }
    if (ready && !importing && pending === null) start(false);
  };
  const launchNow = () => {
    if (needsCheck() && ready) start(false);
  };

  const launchLabel = t(mode === "challenge" ? "setup.startChallenge" : mode === "audit" ? "setup.audit.start" : "home.start");
  const priceLine = live
    ? price
      ? price.amount > 0
        ? t("cost.quote", { label: price.label, price: formatPrice(price.amount, price.currency, i18n.language) })
        : price.label
      : !config?.providerCosts
        ? null
        : estimate && estimate.high <= 0 && (allDemo || allLocal)
          ? t(allDemo ? "home.estimateFree" : "home.estimateLocal")
          : estimate
            ? t("home.estimate", { low: formatUsd(estimate.low, i18n.language), high: formatUsd(estimate.high, i18n.language) })
            : t("setup.estimateUnknown")
    : null;

  const heading = (name: Step, lead?: string) => (
    <div className="wizard-step-head">
      {live ? (
        <p className="field-hint wizard-step-count">{t("wizard.stepOf", { number: STEPS.indexOf(name) + 1, total: STEPS.length })}</p>
      ) : null}
      <h2
        className="heading"
        tabIndex={-1}
        ref={(element) => {
          headings.current[name] = element;
        }}
      >
        {t(`wizard.steps.${name}`)}
      </h2>
      {lead ? <p className="field-hint wizard-lead">{lead}</p> : null}
    </div>
  );

  const seatNames = lineup
    ? // Seats on the same model are named once: "Demo, Demo" is one model.
      [...new Set(Object.values(lineup.seats).map((seat) => modelInfo(config?.catalog ?? [], seat, t).name))].join(", ")
    : "";
  const recap: { step: Step; label: string; value: ReactNode }[] = [
    {
      step: "need",
      label: t(`setup.mode.${mode}`),
      value: (
        <>
          <span className="recap-text">{idea.trim()}</span>
          {template && mode !== "audit" ? <span className="field-hint">{t(`template.${template}`)}</span> : null}
        </>
      ),
    },
    {
      step: "context",
      label: t("wizard.steps.context"),
      value:
        context.length === 0 && complianceTemplates.length === 0 ? (
          <span className="field-hint">{t("wizard.recapNone")}</span>
        ) : (
          <>
            {context.length > 0 ? <span>{t("wizard.recapDocuments", { count: context.length })}</span> : null}
            {complianceTemplates.length > 0 ? (
              <span className="field-hint">{complianceTemplates.map((id) => t(`compliance.template.${id}`)).join(", ")}</span>
            ) : null}
          </>
        ),
    },
    {
      step: "panel",
      label: t("wizard.steps.panel"),
      value: lineup ? (
        <>
          <span>{t("home.lineup", { seats: seatNames, arbiter: modelInfo(config?.catalog ?? [], lineup.arbiter, t).name })}</span>
          <span className="field-hint">
            {[
              lineup.devil ? t("role.devil") : null,
              mode === "express" ? null : t(`wizard.rounds.${ROUND_KEYS[effectiveRounds as 1]}.name`),
              t("wizard.recapDepth", { depth: t(`setup.depthOption.${depth}`) }),
              europeanOnly ? t("european.badge") : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </>
      ) : null,
    },
  ];

  const wizard = (
    <div className="wizard stack" hidden={config === null && !error}>
      {live ? <Stepper step={step} reachable={reachable} onOpen={open} /> : null}
      <form
        ref={fields.form}
        className="card wizard-card"
        onSubmit={onSubmit}
        onKeyDown={(event) => sendOnShortcut(event, pending !== null)}
        noValidate
      >
        <section className="stack-lg wizard-step" hidden={step !== "need"} aria-label={t("wizard.steps.need")}>
          {heading("need")}
          <fieldset className="mode-picker" disabled={!live}>
            <legend className="field-label">{t("setup.modeLabel")}</legend>
            <div className="mode-options">
              {MODES.map((value) => {
                const ModeIcon = MODE_ICONS[value];
                return (
                  <label key={value} className="mode-option" data-checked={mode === value} data-mode={value}>
                    <input type="radio" name="mode" value={value} checked={mode === value} onChange={() => setMode(value)} />
                    <span className="mode-icon">
                      <ModeIcon />
                    </span>
                    <span className="mode-name">{t(`setup.mode.${value}`)}</span>
                    <span className="mode-hint">{t(`setup.modeHint.${value}`)}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          {mode === "audit" ? (
            <div className="stack audit-setup">
              <p className="notice audit-explain">{t("setup.audit.explain")}</p>
              {documents}
            </div>
          ) : null}

          <div className="field">
            <label className="field-label" htmlFor="idea">
              {t(mode === "audit" ? "setup.audit.needLabel" : "home.ideaLabel")}
            </label>
            <textarea
              dir="auto"
              id="idea"
              className="textarea"
              rows={3}
              maxLength={4000}
              placeholder={t(mode === "audit" ? "setup.audit.needPlaceholder" : "home.ideaPlaceholder")}
              value={idea}
              {...fieldProps("idea", fields.errors.idea, "idea-counter")}
              onChange={(event) => {
                fields.clear("idea");
                setIdea(event.target.value);
              }}
              disabled={!live}
            />
            <FieldError id="idea" error={fields.errors.idea} />
            <CharCounter id="idea" value={idea} max={4000} />
          </div>

          {mode === "challenge" ? (
            <div className="field">
              <label className="field-label" htmlFor="solution">
                {t("setup.solutionLabel")}
              </label>
              <textarea
                dir="auto"
                id="solution"
                className="textarea"
                rows={5}
                maxLength={8000}
                placeholder={t("setup.solutionPlaceholder")}
                value={solution}
                {...fieldProps("solution", fields.errors.solution, "solution-counter")}
                onChange={(event) => {
                  fields.clear("solution");
                  setSolution(event.target.value);
                }}
                disabled={!live}
              />
              <FieldError id="solution" error={fields.errors.solution} />
              <CharCounter id="solution" value={solution} max={8000} />
            </div>
          ) : null}

          {config && config.templates.length > 0 && mode !== "audit" ? (
            <ChoiceCards<TemplateId | "none">
              name="template"
              legend={t("setup.templateLabel")}
              lead={t("setup.templateLead")}
              disabled={!live}
              value={template ?? "none"}
              onChange={(next) => setTemplate(next === "none" ? null : next)}
              options={[
                ...config.templates.map((value) => ({ value, label: t(`template.${value}`), hint: t(`templateHint.${value}`) })),
                // No frame: last, since the frames are what most projects start from.
                { value: "none" as const, label: t("setup.templateNone"), hint: t("templateHint.none") },
              ]}
            />
          ) : null}
        </section>

        <section className="stack-lg wizard-step" hidden={step !== "context"} aria-label={t("wizard.steps.context")}>
          {heading("context", t("wizard.contextLead"))}
          {mode === "audit" ? null : documents}
          {config?.complianceTemplates ? (
            <CompliancePicker
              templates={config.complianceTemplates}
              value={complianceTemplates}
              onChange={setComplianceTemplates}
              disabled={!live}
            />
          ) : null}
          {profile ? (
            <p className="notice notice-info wizard-profile">
              {t(profile === "set" ? "wizard.profileSet" : profile === "none" ? "wizard.profileNone" : "wizard.profileWorkspace")}{" "}
              {profile === "workspace" ? null : <a href="#/settings">{t("wizard.profileLink")}</a>}
            </p>
          ) : null}
        </section>

        <section className="stack-lg wizard-step" hidden={step !== "panel"} aria-label={t("wizard.steps.panel")}>
          {heading("panel", t("wizard.panelLead"))}
          {live && config?.european ? (
            <EuropeanToggle
              policy={config.european.policy}
              available={config.european.lineup !== null}
              gateway={config.european.gateway}
              checked={europeanOnly}
              onChange={chooseEuropean}
            />
          ) : null}
          {config && lineup ? (
            <div className="stack">
              {editorOpen ? null : <PanelSummary config={editorConfig ?? config} lineup={lineup} />}
              <div>
                <button
                  ref={editorToggle}
                  type="button"
                  className="button button-secondary"
                  aria-expanded={editorOpen}
                  aria-controls="lineup-editor"
                  onClick={() => setEditorOpen((current) => !current)}
                >
                  {editorOpen ? t("wizard.customizeDone") : t("wizard.customize")}
                </button>
              </div>
              <div id="lineup-editor" hidden={!editorOpen}>
                {editorOpen ? (
                  <div className="stack">
                    <LineupEditor config={editorConfig ?? config} lineup={lineup} defaults={defaults} onChange={setLineup} />
                    {/* The editor is long: it closes from its end too, the focus going back to the button that opened it. */}
                    <div>
                      <button
                        type="button"
                        className="button button-secondary"
                        onClick={() => {
                          setEditorOpen(false);
                          editorToggle.current?.focus();
                        }}
                      >
                        <CheckIcon />
                        {t("wizard.customizeDone")}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
          {mode === "express" ? (
            <div className="choice-group">
              <p className="field-label">{t("home.rounds")}</p>
              <p className="field-hint choice-lead">{t("wizard.expressRounds")}</p>
            </div>
          ) : (
            <ChoiceCards
              name="rounds"
              legend={t("home.rounds")}
              value={rounds}
              onChange={setRounds}
              options={ROUNDS.map((value) => ({
                value,
                label: t(`wizard.rounds.${ROUND_KEYS[value]}.name`),
                hint: t(`wizard.rounds.${ROUND_KEYS[value]}.hint`),
              }))}
            />
          )}
          <ChoiceCards
            name="depth"
            legend={t("setup.depth")}
            value={depth}
            onChange={setDepth}
            options={DEPTHS.map((value) => ({ value, label: t(`setup.depthOption.${value}`), hint: t(`wizard.depthHint.${value}`) }))}
          />
        </section>

        <section className="stack-lg wizard-step" hidden={step !== "review"} aria-label={t("wizard.steps.review")}>
          {heading("review")}
          <div className="stack options-card">
            <h3 className="title">{t("wizard.options")}</h3>
            <div className="switch-list">
              {config?.research?.kind ? (
                <Switch
                  label={t("setup.research")}
                  hint={europeanOnly ? t("setup.researchEuropean") : t("setup.researchHint")}
                  checked={researchOn}
                  disabled={!researchAvailable}
                  onChange={setWebResearch}
                />
              ) : null}
              {mode === "audit" ? (
                <Switch
                  label={t("setup.audit.alternative")}
                  hint={t("setup.audit.alternativeHint")}
                  checked={alternative}
                  onChange={setAlternative}
                />
              ) : null}
              <Switch label={t("setup.redact")} hint={t("setup.redactHint")} checked={redact} onChange={setRedact} />
              {config?.notifications ? <Switch label={t("setup.notify")} checked={notify} onChange={setNotify} /> : null}
            </div>
            {config?.providerCosts ? (
              <div className="field budget-field">
                <label className="field-label" htmlFor="budget">
                  {t("home.budget")}
                </label>
                <input
                  id="budget"
                  className="input"
                  type="number"
                  min={MIN_BUDGET_USD}
                  max={MAX_BUDGET_USD}
                  step="any"
                  inputMode="decimal"
                  placeholder={config.maxBudgetUsd ? formatUsd(config.maxBudgetUsd, i18n.language) : t("home.budgetNone")}
                  value={budget}
                  {...fieldProps("budget", budgetError)}
                  onChange={(event) => {
                    fields.clear("budget");
                    setBudget(event.target.value);
                    setBudgetBad(event.target.validity.badInput);
                  }}
                />
                <FieldError id="budget" error={budgetError} />
              </div>
            ) : null}
          </div>

          <section className="stack" aria-labelledby="recap-title">
            <h3 className="title" id="recap-title">
              {t("wizard.recap")}
            </h3>
            <dl className="recap">
              {recap.map((item) => (
                <div key={item.step} className="recap-row">
                  <dt>{item.label}</dt>
                  <dd>{item.value}</dd>
                  <dd className="recap-edit">
                    <button
                      type="button"
                      className="button button-quiet"
                      aria-label={t("wizard.editStep", { step: t(`wizard.steps.${item.step}`) })}
                      onClick={() => open(item.step)}
                    >
                      {t("wizard.edit")}
                    </button>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        </section>

        {error ? (
          <p className="notice notice-error" role="alert">
            {error}
          </p>
        ) : null}

        {live && overCap ? (
          <p className="notice notice-error" role="alert">
            {t("errors.lineup_cost")}
          </p>
        ) : null}

        {live ? (
          <div className="wizard-nav">
            {step === "review" ? (
              <p className="wizard-price">
                {priceLine}
                {allLocal ? (
                  <span className="chip local-chip">
                    <LocalIcon />
                    {t("setup.local")}
                  </span>
                ) : null}
              </p>
            ) : null}
            <div className="wizard-buttons">
              {index > 0 ? (
                <button type="button" className="button button-secondary" onClick={() => open(STEPS[index - 1] as Step)}>
                  {t("wizard.back")}
                </button>
              ) : null}
              {step === "need" ? (
                <BusyButton
                  className="button button-quiet wizard-now"
                  busy={pending === "live"}
                  busyLabel={t("review.starting")}
                  disabled={pending !== null || importing}
                  aria-describedby="launch-now-hint"
                  onClick={launchNow}
                >
                  {t("wizard.launchNow")}
                </BusyButton>
              ) : null}
              {next ? (
                <button
                  type="submit"
                  className="button button-primary"
                  disabled={step !== "need" && !valid[step]}
                  aria-describedby="step-missing"
                >
                  {t("wizard.next")}
                  <ArrowIcon />
                </button>
              ) : (
                <BusyButton
                  type="submit"
                  busy={pending === "live"}
                  busyLabel={t("review.starting")}
                  disabled={!ready || pending !== null || importing}
                  aria-describedby={importing ? "step-missing" : undefined}
                >
                  {launchLabel}
                  <ArrowIcon />
                </BusyButton>
              )}
            </div>
            <p id="step-missing" className="field-hint wizard-missing" role="status">
              {step === "need" ? "" : (missing[step] ?? "")}
            </p>
            {step === "need" ? (
              <p id="launch-now-hint" className="visually-hidden">
                {t(mode === "audit" ? "wizard.launchNowHintAudit" : "wizard.launchNowHint")}
              </p>
            ) : null}
          </div>
        ) : null}
      </form>
    </div>
  );

  return (
    <div className="narrow stack-lg new-session-page">
      <PageHead title={t("home.newTitle")} lead={t("home.newLead")} />

      {config === null && !error ? <Skeleton lines={6} card /> : null}
      {/* Without a key the recorded demo is the one thing to do: it comes first, the form folds below it. Opened to
          watch it (#/?demo=1), it comes first too, above the form. */}
      {config && (!live || demo) ? (
        <section className="card welcome stack" aria-labelledby="welcome-title">
          <h2 className="heading" id="welcome-title">
            {t("home.welcomeTitle")}
          </h2>
          <p className="muted">{t("home.welcomeLead")}</p>
          <div>
            <BusyButton
              id={DEMO_BUTTON_ID}
              onClick={() => start(true)}
              busy={pending === "demo"}
              busyLabel={t("review.starting")}
              disabled={pending !== null}
            >
              <PlayIcon />
              {t("home.demo")}
            </BusyButton>
          </div>
        </section>
      ) : null}
      {config && !live ? (
        <details className="disclosure">
          <summary>
            <span className="disclosure-title">{t("home.foldTitle")}</span>
          </summary>
          <p className="notice">{t("home.noKey")}</p>
          {wizard}
        </details>
      ) : (
        wizard
      )}
      {live && !demo ? (
        <div className="demo-line">
          <BusyButton
            className="button button-quiet"
            onClick={() => start(true)}
            busy={pending === "demo"}
            busyLabel={t("review.starting")}
            disabled={pending !== null}
          >
            <PlayIcon />
            {t("home.demo")}
          </BusyButton>
          <span className="field-hint">{t("home.demoHint")}</span>
        </div>
      ) : null}
    </div>
  );
}
