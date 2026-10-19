import type { ContextDocument, Depth, Lineup, Mode, ModelOption, Participant, Seat } from "@quorumind/core";
import type { ComplianceTemplateId } from "@quorumind/core/compliance";
import type { Locale } from "@quorumind/core/locales";
import { europeanCatalog } from "@quorumind/core/sovereignty";
import type { TemplateId } from "@quorumind/core/templates";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { navigate, useSessions } from "./App.tsx";
import { type AppConfig, api, type PriceQuote } from "./api.ts";
import { CompliancePicker, EuropeanToggle } from "./components/ComplianceOptions.tsx";
import { ContextPicker } from "./components/ContextPicker.tsx";
import { ArrowIcon, AuditIcon, BoltIcon, CompareIcon, CrossIcon, LocalIcon, PlayIcon, PlusIcon, TargetIcon } from "./components/Icons.tsx";
import { Skeleton } from "./components/Logo.tsx";
import { PageHeading } from "./components/Page.tsx";
import { failureText } from "./errors.ts";
import { formatPrice, formatUsd, groupLabel } from "./format.ts";

const MODES: Mode[] = ["standard", "express", "challenge", "audit"];
const MODE_ICONS = { standard: CompareIcon, express: BoltIcon, challenge: TargetIcon, audit: AuditIcon } as const;
const DEPTHS: Depth[] = ["quick", "standard", "deep"];
const SEAT_KEYS = ["A", "B", "C", "D"] as const;
const CUSTOM = "__custom";

const keyOf = (participant: Participant) => `${participant.provider}:${participant.model}`;

function ModelSelect({
  id,
  catalog,
  value,
  onChange,
}: {
  id: string;
  catalog: ModelOption[];
  value: Participant;
  onChange: (next: Participant) => void;
}) {
  const { t } = useTranslation();
  // Models reached through a gateway are grouped by who made them.
  const groupOf = (option: ModelOption) => (option.maker ? `${option.provider}:${option.maker}` : option.provider);
  const groups = [...new Set(catalog.map(groupOf))];
  return (
    <select
      id={id}
      className="select"
      value={keyOf(value)}
      onChange={(event) => {
        const option = catalog.find((entry) => keyOf(entry) === event.target.value);
        if (option) onChange({ provider: option.provider, model: option.model });
      }}
    >
      {groups.map((group) => {
        const first = catalog.find((option) => groupOf(option) === group);
        return (
          <optgroup key={group} label={first ? groupLabel(first, t) : group}>
            {catalog
              .filter((option) => groupOf(option) === group)
              .map((option) => (
                <option key={keyOf(option)} value={keyOf(option)}>
                  {option.maker ? option.label : option.model}
                </option>
              ))}
          </optgroup>
        );
      })}
    </select>
  );
}

function PersonaField({
  id,
  personas,
  value,
  onChange,
}: {
  id: string;
  personas: string[];
  value: string | null;
  onChange: (next: string | null) => void;
}) {
  const { t } = useTranslation();
  const custom = value !== null && !personas.includes(value);
  return (
    <div className="persona-field">
      <select
        id={id}
        className="select"
        value={value === null ? "" : custom ? CUSTOM : value}
        onChange={(event) => {
          const next = event.target.value;
          onChange(next === "" ? null : next === CUSTOM ? "" : next);
        }}
      >
        <option value="">{t("setup.personaNone")}</option>
        {personas.map((persona) => (
          <option key={persona} value={persona}>
            {t(`persona.${persona}`)}
          </option>
        ))}
        <option value={CUSTOM}>{t("setup.personaCustom")}</option>
      </select>
      {custom ? (
        <input
          className="input"
          aria-label={t("setup.personaCustomLabel")}
          placeholder={t("setup.personaCustomPlaceholder")}
          maxLength={200}
          value={value ?? ""}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : null}
    </div>
  );
}

function LineupEditor({ config, lineup, onChange }: { config: AppConfig; lineup: Lineup; onChange: (next: Lineup) => void }) {
  const { t } = useTranslation();
  const seats = Object.entries(lineup.seats);
  const setSeat = (key: string, seat: Seat) => onChange({ ...lineup, seats: { ...lineup.seats, [key]: seat } });
  const fallback = (seats.at(-1)?.[1] ?? lineup.arbiter) as Participant;

  return (
    <div className="lineup stack">
      <div className="lineup-grid">
        <span className="field-hint lineup-head">{t("setup.role")}</span>
        <span className="field-hint lineup-head">{t("setup.model")}</span>
        <span className="field-hint lineup-head">{t("setup.persona")}</span>
        <span />
        {seats.map(([key, seat], index) => (
          <div className="lineup-row" key={key}>
            <label className="lineup-role" htmlFor={`seat-${key}`}>
              <span className={`seat-dot seat-${key}`} aria-hidden="true" />
              {t("role.proposer", { seat: key })}
            </label>
            <ModelSelect
              id={`seat-${key}`}
              catalog={config.catalog}
              value={seat}
              onChange={(next) => setSeat(key, { ...next, persona: seat.persona })}
            />
            <PersonaField
              id={`persona-${key}`}
              personas={config.personas}
              value={seat.persona}
              onChange={(persona) => setSeat(key, { ...seat, persona })}
            />
            {index >= 2 && index === seats.length - 1 ? (
              <button
                type="button"
                className="icon-button"
                aria-label={t("setup.removeSeat", { seat: key })}
                onClick={() => {
                  const next = { ...lineup.seats };
                  delete next[key];
                  onChange({ ...lineup, seats: next });
                }}
              >
                <CrossIcon />
              </button>
            ) : (
              <span />
            )}
          </div>
        ))}
        {lineup.devil ? (
          <div className="lineup-row">
            <label className="lineup-role" htmlFor="seat-devil">
              <span className="seat-dot seat-devil" aria-hidden="true" />
              {t("role.devil")}
            </label>
            <ModelSelect
              id="seat-devil"
              catalog={config.catalog}
              value={lineup.devil}
              onChange={(next) => onChange({ ...lineup, devil: { ...next, persona: lineup.devil?.persona ?? null } })}
            />
            <PersonaField
              id="persona-devil"
              personas={config.personas}
              value={lineup.devil.persona}
              onChange={(persona) => onChange({ ...lineup, devil: lineup.devil ? { ...lineup.devil, persona } : null })}
            />
            <button
              type="button"
              className="icon-button"
              aria-label={t("setup.removeDevil")}
              onClick={() => onChange({ ...lineup, devil: null })}
            >
              <CrossIcon />
            </button>
          </div>
        ) : null}
        <div className="lineup-row">
          <label className="lineup-role" htmlFor="seat-interviewer">
            {t("role.interviewer")}
          </label>
          <ModelSelect
            id="seat-interviewer"
            catalog={config.catalog}
            value={lineup.interviewer}
            onChange={(interviewer) => onChange({ ...lineup, interviewer })}
          />
          <span />
          <span />
        </div>
        <div className="lineup-row">
          <label className="lineup-role" htmlFor="seat-arbiter">
            {t("role.arbiter")}
          </label>
          <ModelSelect
            id="seat-arbiter"
            catalog={config.catalog}
            value={lineup.arbiter}
            onChange={(arbiter) => onChange({ ...lineup, arbiter })}
          />
          <span />
          <span />
        </div>
      </div>
      <div className="row">
        {seats.length < SEAT_KEYS.length ? (
          <button
            type="button"
            className="button button-quiet"
            onClick={() => setSeat(SEAT_KEYS[seats.length] as string, { ...fallback, persona: null })}
          >
            <PlusIcon />
            {t("setup.addSeat")}
          </button>
        ) : null}
        {lineup.devil ? null : (
          <button
            type="button"
            className="button button-quiet"
            onClick={() => onChange({ ...lineup, devil: { ...lineup.arbiter, persona: null } })}
          >
            <PlusIcon />
            {t("setup.addDevil")}
          </button>
        )}
      </div>
      <p className="field-hint" style={{ margin: 0 }}>
        {t("setup.devilHint")}
      </p>
    </div>
  );
}

export function NewSession() {
  const { t, i18n } = useTranslation();
  const { refresh } = useSessions();
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [mode, setMode] = useState<Mode>("standard");
  const [idea, setIdea] = useState("");
  const [solution, setSolution] = useState("");
  const [template, setTemplate] = useState<TemplateId | null>(null);
  const [complianceTemplates, setComplianceTemplates] = useState<ComplianceTemplateId[]>([]);
  const [europeanOnly, setEuropeanOnly] = useState(false);
  const [context, setContext] = useState<ContextDocument[]>([]);
  // Audit mode: every attached document is under audit unless the person marks it as background.
  const [background, setBackground] = useState<string[]>([]);
  const [alternative, setAlternative] = useState(false);
  const [lineup, setLineup] = useState<Lineup | null>(null);
  const [depth, setDepth] = useState<Depth>("standard");
  const [rounds, setRounds] = useState(1);
  const [budget, setBudget] = useState("");
  const [redact, setRedact] = useState(false);
  // Null follows the default of the server (or of the price tier) for these settings, until the person ticks or unticks it.
  const [webResearch, setWebResearch] = useState<boolean | null>(null);
  const [researchDefault, setResearchDefault] = useState(false);
  const [notify, setNotify] = useState(false);
  const [estimate, setEstimate] = useState<{ low: number; high: number } | null>(null);
  const [price, setPrice] = useState<PriceQuote | null>(null);
  const [pending, setPending] = useState<"live" | "demo" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Starting while a document is still being imported would leave it out of the session.
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    api.config().then(
      (loaded) => {
        setConfig(loaded);
        const european = Boolean(loaded.european?.policy && loaded.european.lineup);
        setEuropeanOnly(european || loaded.european?.policy === "required");
        setLineup((european ? loaded.european?.lineup : null) ?? loaded.live?.lineup ?? null);
      },
      () => setError(t("error.request")),
    );
  }, [t]);

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
      api.estimate(lineup, effectiveRounds, mode, depth, language, mode === "audit" && alternative, researchChoice).then(
        (body) => {
          // An answer to settings changed since is dropped: the estimate on screen is the latest one's.
          if (!live) return;
          setEstimate(body.estimateUsd);
          setPrice(body.price);
          if (body.research) setResearchDefault(body.research.default);
        },
        () => {
          if (!live) return;
          setEstimate(null);
          setPrice(null);
        },
      );
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [lineup, effectiveRounds, mode, depth, language, alternative, researchChoice]);

  const allLocal = useMemo(() => {
    if (!config || !lineup) return false;
    const participants = [lineup.interviewer, lineup.arbiter, ...Object.values(lineup.seats), ...(lineup.devil ? [lineup.devil] : [])];
    return participants.every((participant) => config.catalog.find((option) => keyOf(option) === keyOf(participant))?.local);
  }, [config, lineup]);

  const start = async (demo: boolean) => {
    setPending(demo ? "demo" : "live");
    setError(null);
    try {
      const budgetUsd = budget.trim() ? Number(budget) : null;
      const { session } = await api.create({
        locale: i18n.language as Locale,
        idea: demo ? "" : idea.trim(),
        demo,
        mode,
        template,
        complianceTemplates: demo ? [] : complianceTemplates,
        europeanOnly: !demo && europeanOnly,
        ...(demo || researchChoice === undefined ? {} : { webResearch: researchChoice }),
        depth,
        rounds: effectiveRounds,
        budgetUsd: budgetUsd && budgetUsd > 0 ? budgetUsd : null,
        lineup: demo ? null : lineup,
        challenge: mode === "challenge" ? solution.trim() : null,
        audit: mode === "audit" && !demo ? { documentIds: audited, alternative } : null,
        context: demo ? [] : context,
        redact,
        notify,
      });
      refresh();
      navigate(`s/${session.id}`);
    } catch (caught) {
      setError(failureText(t, caught));
      setPending(null);
    }
  };

  // European models only: the lineup editor offers the European models, and the lineup starts from their default.
  const editorConfig = useMemo(
    () => (config && europeanOnly ? { ...config, catalog: europeanCatalog(config.catalog) } : config),
    [config, europeanOnly],
  );
  const chooseEuropean = (next: boolean) => {
    setEuropeanOnly(next);
    setLineup((next ? config?.european?.lineup : config?.live?.lineup) ?? config?.live?.lineup ?? null);
  };

  const live = config?.live ?? null;
  const audited = context.filter((document) => !background.includes(document.id)).map((document) => document.id);
  const toggleAudited = (id: string) =>
    setBackground((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  const documents = (
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
  );

  const ready = Boolean(live && idea.trim() && (mode !== "challenge" || solution.trim()) && (mode !== "audit" || audited.length > 0));
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (ready && !importing) start(false);
  };

  return (
    <div className="narrow stack-lg new-session-page">
      <div className="stack">
        <PageHeading title={t("home.newTitle")} />
        <p className="lead" style={{ margin: 0 }}>
          {t("home.newLead")}
        </p>
      </div>

      {config === null && !error ? <Skeleton lines={6} card /> : null}
      <form className="card stack-lg" onSubmit={onSubmit} hidden={config === null && !error}>
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
            {context.length > 0 && audited.length === 0 ? (
              <p className="notice notice-error" role="alert">
                {t("setup.audit.noneAudited")}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="field">
          <label className="field-label" htmlFor="idea">
            {t(mode === "audit" ? "setup.audit.needLabel" : "home.ideaLabel")}
          </label>
          <textarea
            id="idea"
            className="textarea"
            rows={3}
            maxLength={4000}
            placeholder={t(mode === "audit" ? "setup.audit.needPlaceholder" : "home.ideaPlaceholder")}
            value={idea}
            onChange={(event) => setIdea(event.target.value)}
            disabled={!live}
          />
        </div>

        {mode === "challenge" ? (
          <div className="field">
            <label className="field-label" htmlFor="solution">
              {t("setup.solutionLabel")}
            </label>
            <textarea
              id="solution"
              className="textarea"
              rows={5}
              maxLength={8000}
              placeholder={t("setup.solutionPlaceholder")}
              value={solution}
              onChange={(event) => setSolution(event.target.value)}
              disabled={!live}
            />
          </div>
        ) : null}

        {config && config.templates.length > 0 ? (
          <fieldset className="template-picker" disabled={!live}>
            <legend className="field-label">{t("setup.templateLabel")}</legend>
            <div className="chips">
              <button type="button" className="chip-toggle" aria-pressed={template === null} onClick={() => setTemplate(null)}>
                {t("setup.templateNone")}
              </button>
              {config.templates.map((value) => (
                <button
                  key={value}
                  type="button"
                  className="chip-toggle"
                  aria-pressed={template === value}
                  onClick={() => setTemplate(value)}
                >
                  {t(`template.${value}`)}
                </button>
              ))}
            </div>
          </fieldset>
        ) : null}

        {config?.complianceTemplates ? (
          <CompliancePicker
            templates={config.complianceTemplates}
            value={complianceTemplates}
            onChange={setComplianceTemplates}
            disabled={!live}
          />
        ) : null}

        {mode === "audit" ? null : documents}

        {live && config?.european ? (
          <EuropeanToggle
            policy={config.european.policy}
            available={config.european.lineup !== null}
            gateway={config.european.gateway}
            checked={europeanOnly}
            onChange={chooseEuropean}
          />
        ) : null}

        {live && config && lineup ? (
          <details className="settings">
            <summary>{t("setup.settings")}</summary>
            <div className="stack">
              <div className="options">
                {mode === "express" ? null : (
                  <div className="field">
                    <label className="field-hint" htmlFor="rounds">
                      {t("home.rounds")}
                    </label>
                    <select id="rounds" className="select" value={rounds} onChange={(event) => setRounds(Number(event.target.value))}>
                      {[1, 2, 3].map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="field">
                  <label className="field-hint" htmlFor="depth">
                    {t("setup.depth")}
                  </label>
                  <select id="depth" className="select" value={depth} onChange={(event) => setDepth(event.target.value as Depth)}>
                    {DEPTHS.map((value) => (
                      <option key={value} value={value}>
                        {t(`setup.depthOption.${value}`)}
                      </option>
                    ))}
                  </select>
                </div>
                {config.providerCosts ? (
                  <div className="field">
                    <label className="field-hint" htmlFor="budget">
                      {t("home.budget")}
                    </label>
                    <input
                      id="budget"
                      className="input"
                      type="number"
                      min="0"
                      step="0.5"
                      inputMode="decimal"
                      placeholder={config.maxBudgetUsd ? formatUsd(config.maxBudgetUsd, i18n.language) : t("home.budgetNone")}
                      value={budget}
                      onChange={(event) => setBudget(event.target.value)}
                    />
                  </div>
                ) : null}
              </div>
              {mode === "audit" ? (
                <label className="check">
                  <input type="checkbox" checked={alternative} onChange={(event) => setAlternative(event.target.checked)} />
                  <span>
                    {t("setup.audit.alternative")}
                    <span className="field-hint">{t("setup.audit.alternativeHint")}</span>
                  </span>
                </label>
              ) : null}
              <LineupEditor config={editorConfig ?? config} lineup={lineup} onChange={setLineup} />
              {config.research?.kind ? (
                <label className="check">
                  <input
                    type="checkbox"
                    checked={researchOn}
                    disabled={!researchAvailable}
                    onChange={(event) => setWebResearch(event.target.checked)}
                  />
                  <span>
                    {t("setup.research")}
                    <span className="field-hint">{europeanOnly ? t("setup.researchEuropean") : t("setup.researchHint")}</span>
                  </span>
                </label>
              ) : null}
              <label className="check">
                <input type="checkbox" checked={redact} onChange={(event) => setRedact(event.target.checked)} />
                <span>
                  {t("setup.redact")}
                  <span className="field-hint">{t("setup.redactHint")}</span>
                </span>
              </label>
              {config.notifications ? (
                <label className="check">
                  <input type="checkbox" checked={notify} onChange={(event) => setNotify(event.target.checked)} />
                  <span>{t("setup.notify")}</span>
                </label>
              ) : null}
            </div>
          </details>
        ) : null}

        {live ? (
          <p className="field-hint" style={{ margin: 0 }}>
            {price
              ? price.amount > 0
                ? t("cost.quote", { label: price.label, price: formatPrice(price.amount, price.currency, i18n.language) })
                : price.label
              : !config?.providerCosts
                ? null
                : estimate
                  ? t("home.estimate", { low: formatUsd(estimate.low, i18n.language), high: formatUsd(estimate.high, i18n.language) })
                  : t("setup.estimateUnknown")}
            {allLocal ? (
              <span className="chip local-chip">
                <LocalIcon />
                {t("setup.local")}
              </span>
            ) : null}
          </p>
        ) : null}
        {config && !live ? <p className="notice">{t("home.noKey")}</p> : null}
        {error ? (
          <p className="notice notice-error" role="alert">
            {error}
          </p>
        ) : null}
        <div>
          <button
            type="submit"
            className="button button-primary"
            disabled={!ready || pending !== null || importing}
            aria-describedby={importing ? "importing-note" : undefined}
          >
            {t(mode === "challenge" ? "setup.startChallenge" : mode === "audit" ? "setup.audit.start" : "home.start")}
            <ArrowIcon />
          </button>
          {importing ? (
            <p id="importing-note" className="field-hint" role="status" style={{ margin: 0 }}>
              {t("setup.importing")}
            </p>
          ) : null}
        </div>
      </form>

      <div className="demo-line">
        <button type="button" className="button button-quiet" onClick={() => start(true)} disabled={pending !== null}>
          <PlayIcon />
          {t("home.demo")}
        </button>
        <span className="field-hint">{t("home.demoHint")}</span>
      </div>
    </div>
  );
}
