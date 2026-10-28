import type { Lineup, ModelOption, Participant, Seat } from "@quorumind/core";
import type { TFunction } from "i18next";
import { type ReactNode, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AppConfig } from "../api.ts";
import { modelName, vendorLabel } from "../format.ts";
import { Switch } from "./Controls.tsx";
import { ArbiterIcon, CrossIcon, DevilIcon, InterviewIcon, PlusIcon } from "./Icons.tsx";

// The panel of a new session: who proposes, who attacks, who interviews and who rules, each with its model and its
// expert role. A summary first; cards to change it.

const SEAT_KEYS = ["A", "B", "C", "D"] as const;
const CUSTOM = "__custom";

export const keyOf = (participant: Participant) => `${participant.provider}:${participant.model}`;

const sameModel = (a: Participant | null | undefined, b: Participant | null | undefined) => Boolean(a && b && keyOf(a) === keyOf(b));

function ModelSelect({
  id,
  catalog,
  value,
  onChange,
  describedBy,
}: {
  id: string;
  catalog: ModelOption[];
  value: Participant;
  onChange: (next: Participant) => void;
  describedBy?: string;
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
      aria-describedby={describedBy}
      onChange={(event) => {
        const option = catalog.find((entry) => keyOf(entry) === event.target.value);
        if (option) onChange({ provider: option.provider, model: option.model });
      }}
    >
      {groups.map((group) => {
        const first = catalog.find((option) => groupOf(option) === group);
        return (
          <optgroup key={group} label={first ? vendorLabel(first, t) : group}>
            {catalog
              .filter((option) => groupOf(option) === group)
              .map((option) => (
                <option key={keyOf(option)} value={keyOf(option)}>
                  {option.premium ? t("setup.premiumModel", { model: modelName(option) }) : modelName(option)}
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
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {t("setup.persona")}
      </label>
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

/** The name of a model as the person knows it, and who makes it when a gateway serves it. */
export function modelInfo(catalog: ModelOption[], participant: Participant, t: TFunction) {
  const option = catalog.find((entry) => keyOf(entry) === keyOf(participant));
  return { name: option ? modelName(option) : participant.model, maker: option ? vendorLabel(option, t) : null };
}

/** One role of the panel as a card: its badge, its name, what it does, then its model and its expert role. */
function RoleCard({
  badge,
  badgeClass,
  title,
  hint,
  onRemove,
  removeLabel,
  children,
}: {
  badge: ReactNode;
  badgeClass: string;
  title: string;
  hint: string;
  onRemove?: () => void;
  removeLabel?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section className="role-card" aria-labelledby={`${id}-title`}>
      <div className="role-card-head">
        <span className={`seat-badge ${badgeClass}`} aria-hidden="true">
          {badge}
        </span>
        <div className="role-card-title">
          <h4 className="role-card-name" id={`${id}-title`}>
            {title}
          </h4>
          <p className="field-hint">{hint}</p>
        </div>
        {onRemove ? (
          <button type="button" className="icon-button role-card-remove" aria-label={removeLabel} onClick={onRemove}>
            <CrossIcon />
          </button>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function ModelField({
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
  const { maker } = modelInfo(catalog, value, t);
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {t("setup.model")}
      </label>
      <ModelSelect id={id} catalog={catalog} value={value} onChange={onChange} describedBy={maker ? `${id}-maker` : undefined} />
      {maker ? (
        <span className="field-hint" id={`${id}-maker`}>
          {maker}
        </span>
      ) : null}
    </div>
  );
}

/** The panel at a glance: each role, its model and its expert role. */
export function PanelSummary({ config, lineup }: { config: AppConfig; lineup: Lineup }) {
  const { t } = useTranslation();
  const row = (key: string, badge: ReactNode, badgeClass: string, role: string, participant: Participant, persona?: string | null) => {
    const { name, maker } = modelInfo(config.catalog, participant, t);
    const expert = persona ? (config.personas.includes(persona) ? t(`persona.${persona}`) : persona) : null;
    return (
      <li key={key}>
        <span className={`seat-badge ${badgeClass}`} aria-hidden="true">
          {badge}
        </span>
        <span className="panel-role">{role}</span>
        <span className="panel-model">
          <span className="panel-model-name">{name}</span>
          {maker || expert ? <span className="field-hint">{[maker, expert].filter(Boolean).join(" · ")}</span> : null}
        </span>
      </li>
    );
  };
  return (
    <ul className="panel-summary">
      {Object.entries(lineup.seats).map(([key, seat]) =>
        row(key, key, `seat-${key}`, t("role.proposer", { seat: key }), seat, seat.persona),
      )}
      {lineup.devil ? row("devil", <DevilIcon />, "seat-devil", t("role.devil"), lineup.devil, lineup.devil.persona) : null}
      {row("interviewer", <InterviewIcon />, "seat-host", t("role.interviewer"), lineup.interviewer)}
      {row("arbiter", <ArbiterIcon />, "seat-host", t("role.arbiter"), lineup.arbiter)}
    </ul>
  );
}

export function LineupEditor({
  config,
  lineup,
  defaults,
  onChange,
}: {
  config: AppConfig;
  lineup: Lineup;
  defaults: Lineup | null;
  onChange: (next: Lineup) => void;
}) {
  const { t } = useTranslation();
  const seats = Object.entries(lineup.seats);
  const setSeat = (key: string, seat: Seat) => onChange({ ...lineup, seats: { ...lineup.seats, [key]: seat } });
  const fallback = (seats.at(-1)?.[1] ?? lineup.arbiter) as Participant;
  const customHosts = !sameModel(lineup.interviewer, defaults?.interviewer) || !sameModel(lineup.arbiter, defaults?.arbiter);
  const [hostsOpen, setHostsOpen] = useState(customHosts);

  return (
    <div className="stack lineup">
      <section className="stack" aria-labelledby="debaters-title">
        <h3 className="title" id="debaters-title">
          {t("wizard.debaters")}
        </h3>
        <div className="role-cards">
          {seats.map(([key, seat], index) => (
            <RoleCard
              key={key}
              badge={key}
              badgeClass={`seat-${key}`}
              title={t("role.proposer", { seat: key })}
              hint={t("wizard.proposerHint")}
              {...(index >= 2 && index === seats.length - 1
                ? {
                    removeLabel: t("setup.removeSeat", { seat: key }),
                    onRemove: () => {
                      const next = { ...lineup.seats };
                      delete next[key];
                      onChange({ ...lineup, seats: next });
                    },
                  }
                : {})}
            >
              <ModelField
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
            </RoleCard>
          ))}
          {seats.length < SEAT_KEYS.length ? (
            <button
              type="button"
              className="role-card-add"
              onClick={() => setSeat(SEAT_KEYS[seats.length] as string, { ...fallback, persona: null })}
            >
              <PlusIcon />
              {t("setup.addSeat")}
            </button>
          ) : null}
        </div>
      </section>

      <section className="role-card role-card-devil" aria-label={t("role.devil")} data-on={Boolean(lineup.devil)}>
        <div className="role-card-head">
          <span className="seat-badge seat-devil" aria-hidden="true">
            <DevilIcon />
          </span>
          <div className="role-card-title">
            <Switch
              label={t("role.devil")}
              hint={t("setup.devilHint")}
              checked={Boolean(lineup.devil)}
              onChange={(on) => onChange({ ...lineup, devil: on ? { ...lineup.arbiter, persona: null } : null })}
            />
          </div>
        </div>
        {lineup.devil ? (
          <div className="role-card-fields">
            <ModelField
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
          </div>
        ) : null}
      </section>

      <details className="disclosure" open={hostsOpen} onToggle={(event) => setHostsOpen(event.currentTarget.open)}>
        <summary>
          <span className="disclosure-title">{t("wizard.moderation")}</span>
          <span className="field-hint">{t("wizard.moderationHint")}</span>
        </summary>
        <div className="role-cards">
          <RoleCard badge={<InterviewIcon />} badgeClass="seat-host" title={t("role.interviewer")} hint={t("wizard.interviewerHint")}>
            <ModelField
              id="seat-interviewer"
              catalog={config.catalog}
              value={lineup.interviewer}
              onChange={(interviewer) => onChange({ ...lineup, interviewer })}
            />
          </RoleCard>
          <RoleCard badge={<ArbiterIcon />} badgeClass="seat-host" title={t("role.arbiter")} hint={t("wizard.arbiterHint")}>
            <ModelField
              id="seat-arbiter"
              catalog={config.catalog}
              value={lineup.arbiter}
              onChange={(arbiter) => onChange({ ...lineup, arbiter })}
            />
          </RoleCard>
        </div>
      </details>
    </div>
  );
}
