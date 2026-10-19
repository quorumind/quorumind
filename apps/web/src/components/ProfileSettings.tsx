import type { OrgProfile } from "@quorumind/core";
import { currencyCode, EMPTY_PROFILE, PROFILE_LIMITS } from "@quorumind/core/profile";
import { type FormEvent, useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type ProfileInput } from "../api.ts";
import { failureText } from "../errors.ts";
import { CrossIcon } from "./Icons.tsx";
import { LoadFailed } from "./LoadFailed.tsx";

type Status = { kind: "idle" } | { kind: "saving" } | { kind: "done"; message: string } | { kind: "error"; message: string };

/** The form's state: lists as one item per line, numbers as typed. */
interface Draft {
  name: string;
  preferred: string;
  forbidden: string;
  euOnly: boolean;
  onPremises: boolean;
  providers: string;
  hostingNotes: string;
  currency: string;
  roles: { key: number; name: string; dailyRate: string }[];
  people: string;
  teamSize: string;
  deliverables: string;
  guarantees: string;
  notes: string;
}

const lines = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
const count = (text: string) => (text.trim() === "" || !Number.isFinite(Number(text)) ? null : Math.max(0, Math.round(Number(text))));

function draftOf(profile: OrgProfile): Draft {
  return {
    name: profile.name,
    preferred: profile.preferredTechnologies.join("\n"),
    forbidden: profile.forbiddenTechnologies.join("\n"),
    euOnly: profile.hosting.euOnly,
    onPremises: profile.hosting.onPremises,
    providers: profile.hosting.providers.join("\n"),
    hostingNotes: profile.hosting.notes,
    currency: profile.currency,
    roles: profile.roles.map((role, key) => ({ key, name: role.name, dailyRate: String(role.dailyRate) })),
    people: profile.capacity.people === null ? "" : String(profile.capacity.people),
    teamSize: profile.capacity.typicalTeamSize === null ? "" : String(profile.capacity.typicalTeamSize),
    deliverables: profile.deliverables.join("\n"),
    guarantees: profile.guarantees.join("\n"),
    notes: profile.notes,
  };
}

function inputOf(draft: Draft): ProfileInput {
  return {
    name: draft.name.trim(),
    preferredTechnologies: lines(draft.preferred),
    forbiddenTechnologies: lines(draft.forbidden),
    hosting: { euOnly: draft.euOnly, providers: lines(draft.providers), onPremises: draft.onPremises, notes: draft.hostingNotes.trim() },
    currency: draft.currency.trim().toUpperCase(),
    roles: draft.roles
      .filter((role) => role.name.trim())
      .map((role) => ({ name: role.name.trim(), dailyRate: Number(role.dailyRate.replace(",", ".")) })),
    capacity: { people: count(draft.people), typicalTeamSize: count(draft.teamSize) },
    deliverables: lines(draft.deliverables),
    guarantees: lines(draft.guarantees),
    notes: draft.notes.trim(),
  };
}

/**
 * The organisation profile of a self-hosted server: what it sells and can deliver. Proposals stay within it and are
 * priced with its day rates; each debate keeps the profile as it was when it started.
 */
export function ProfileSettings({ defaultCurrency }: { defaultCurrency: string }) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const [draft, setDraft] = useState<Draft>(() => draftOf({ ...EMPTY_PROFILE, currency: defaultCurrency }));
  const [savedAt, setSavedAt] = useState<string | null>(null);
  // Nothing can be changed, nor saved, until the saved profile is loaded: saving the empty form would erase it.
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` asks again.
  useEffect(() => {
    let cancelled = false;
    setLoadFailed(false);
    api.profile().then(
      ({ profile }) => {
        if (cancelled) return;
        if (profile) {
          setDraft(draftOf(profile));
          setSavedAt(profile.updatedAt);
        }
        setLoaded(true);
      },
      () => {
        if (!cancelled) setLoadFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const update = (patch: Partial<Draft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setStatus({ kind: "idle" });
  };
  const updateRole = (key: number, patch: Partial<Draft["roles"][number]>) =>
    update({ roles: draft.roles.map((role) => (role.key === key ? { ...role, ...patch } : role)) });

  const save = async (input: ProfileInput | null, message: string) => {
    setStatus({ kind: "saving" });
    try {
      const { profile } = await api.saveProfile(input);
      if (profile) setDraft(draftOf(profile));
      else setDraft(draftOf({ ...EMPTY_PROFILE, currency: defaultCurrency }));
      setSavedAt(profile?.updatedAt ?? null);
      setStatus({ kind: "done", message });
    } catch (caught) {
      setStatus({ kind: "error", message: failureText(t, caught) });
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!currencyCode(draft.currency)) return setStatus({ kind: "error", message: t("profile.currencyInvalid") });
    const input = inputOf(draft);
    if (input.roles.some((role) => !Number.isFinite(role.dailyRate) || role.dailyRate <= 0)) {
      return setStatus({ kind: "error", message: t("profile.rateInvalid") });
    }
    void save(input, t("profile.saved"));
  };

  const list = (key: "preferred" | "forbidden" | "providers" | "deliverables" | "guarantees", label: string, hint?: string) => (
    <div className="field">
      <label className="field-label" htmlFor={`${id}-${key}`}>
        {label}
      </label>
      <textarea
        id={`${id}-${key}`}
        className={`textarea${key === "forbidden" ? " textarea-hard" : ""}`}
        rows={3}
        value={draft[key]}
        onChange={(event) => update({ [key]: event.target.value })}
        aria-describedby={`${id}-${key}-hint`}
        disabled={!loaded}
      />
      <span className="field-hint" id={`${id}-${key}-hint`}>
        {hint ? `${hint} ` : ""}
        {t("profile.onePerLine")}
      </span>
    </div>
  );

  const saving = status.kind === "saving";
  const nextKey = Math.max(-1, ...draft.roles.map((role) => role.key)) + 1;
  return (
    <form className="card stack profile-settings" onSubmit={onSubmit} aria-busy={!loaded || saving}>
      <div className="stack" style={{ gap: "var(--space-2)" }}>
        <h2 className="heading">{t("profile.title")}</h2>
        <p className="field-hint" style={{ margin: 0 }}>
          {t("profile.lead")}
        </p>
        {loadFailed ? <LoadFailed onRetry={() => setAttempt((count) => count + 1)} /> : null}
        {savedAt ? (
          <span className="field-hint">
            {t("profile.lastSaved", { date: new Intl.DateTimeFormat(i18n.language, { dateStyle: "long" }).format(new Date(savedAt)) })}
          </span>
        ) : null}
      </div>

      <label className="field" htmlFor={`${id}-name`}>
        <span className="field-label">{t("profile.name")}</span>
        <input
          id={`${id}-name`}
          className="input"
          value={draft.name}
          maxLength={PROFILE_LIMITS.name}
          placeholder={t("profile.namePlaceholder")}
          onChange={(event) => update({ name: event.target.value })}
          disabled={!loaded}
        />
      </label>

      <div className="two-col">
        {list("forbidden", t("profile.forbidden"), t("profile.forbiddenHint"))}
        {list("preferred", t("profile.preferred"), t("profile.preferredHint"))}
      </div>

      <fieldset className="field profile-group">
        <legend className="field-label">{t("profile.hosting")}</legend>
        <label className="check">
          <input type="checkbox" checked={draft.euOnly} onChange={(event) => update({ euOnly: event.target.checked })} disabled={!loaded} />
          <span>{t("profile.euOnly")}</span>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={draft.onPremises}
            onChange={(event) => update({ onPremises: event.target.checked })}
            disabled={!loaded}
          />
          <span>{t("profile.onPremises")}</span>
        </label>
        <div className="two-col">
          {list("providers", t("profile.providers"), t("profile.providersHint"))}
          <div className="field">
            <label className="field-label" htmlFor={`${id}-hosting-notes`}>
              {t("profile.hostingNotes")}
            </label>
            <textarea
              id={`${id}-hosting-notes`}
              className="textarea"
              rows={3}
              maxLength={PROFILE_LIMITS.notes}
              value={draft.hostingNotes}
              onChange={(event) => update({ hostingNotes: event.target.value })}
              disabled={!loaded}
            />
          </div>
        </div>
      </fieldset>

      <fieldset className="field profile-group">
        <legend className="field-label">{t("profile.roles")}</legend>
        <p className="field-hint" style={{ margin: 0 }}>
          {t("profile.rolesHint")}
        </p>
        <div className="field profile-currency">
          <label className="field-label" htmlFor={`${id}-currency`}>
            {t("profile.currency")}
          </label>
          <input
            id={`${id}-currency`}
            className="input mono"
            maxLength={3}
            autoCapitalize="characters"
            spellCheck={false}
            value={draft.currency}
            onChange={(event) => update({ currency: event.target.value.toUpperCase() })}
            disabled={!loaded}
          />
        </div>
        {draft.roles.map((role, index) => (
          <div className="profile-role" key={role.key}>
            <input
              className="input"
              aria-label={t("profile.role", { number: index + 1 })}
              placeholder={t("profile.rolePlaceholder")}
              maxLength={PROFILE_LIMITS.item}
              value={role.name}
              onChange={(event) => updateRole(role.key, { name: event.target.value })}
              disabled={!loaded}
            />
            <input
              className="input mono"
              type="number"
              min={0}
              step="any"
              inputMode="decimal"
              aria-label={t("profile.dailyRate", { number: index + 1, currency: draft.currency })}
              placeholder={t("profile.dailyRatePlaceholder", { currency: draft.currency })}
              value={role.dailyRate}
              onChange={(event) => updateRole(role.key, { dailyRate: event.target.value })}
              disabled={!loaded}
            />
            <button
              type="button"
              className="icon-button"
              style={{ inlineSize: 24, blockSize: 24, border: 0 }}
              aria-label={t("profile.removeRole", { name: role.name || index + 1 })}
              onClick={() => update({ roles: draft.roles.filter((item) => item.key !== role.key) })}
            >
              <CrossIcon />
            </button>
          </div>
        ))}
        {draft.roles.length < PROFILE_LIMITS.roles ? (
          <div>
            <button
              type="button"
              className="button button-quiet"
              onClick={() => update({ roles: [...draft.roles, { key: nextKey, name: "", dailyRate: "" }] })}
              disabled={!loaded}
            >
              + {t("profile.addRole")}
            </button>
          </div>
        ) : null}
      </fieldset>

      <fieldset className="field profile-group">
        <legend className="field-label">{t("profile.capacity")}</legend>
        <div className="two-col">
          {(["people", "teamSize"] as const).map((key) => (
            <div className="field" key={key}>
              <label className="field-label" htmlFor={`${id}-${key}`}>
                {t(`profile.${key}`)}
              </label>
              <input
                id={`${id}-${key}`}
                className="input"
                type="number"
                min={0}
                inputMode="numeric"
                value={draft[key]}
                onChange={(event) => update({ [key]: event.target.value })}
                disabled={!loaded}
              />
            </div>
          ))}
        </div>
      </fieldset>

      <div className="two-col">
        {list("deliverables", t("profile.deliverables"))}
        {list("guarantees", t("profile.guarantees"))}
      </div>

      <div className="field">
        <label className="field-label" htmlFor={`${id}-notes`}>
          {t("profile.notes")}
        </label>
        <textarea
          id={`${id}-notes`}
          className="textarea"
          rows={3}
          maxLength={PROFILE_LIMITS.notes}
          value={draft.notes}
          onChange={(event) => update({ notes: event.target.value })}
          disabled={!loaded}
        />
      </div>

      <div className="row">
        <button type="submit" className="button button-primary" disabled={!loaded || saving}>
          {saving ? t("profile.saving") : t("profile.save")}
        </button>
        {savedAt ? (
          <button
            type="button"
            className="button button-secondary"
            onClick={() => void save(null, t("profile.cleared"))}
            disabled={!loaded || saving}
          >
            {t("profile.clear")}
          </button>
        ) : null}
        <span role="status" className={status.kind === "error" ? "branding-error" : "field-hint"}>
          {status.kind === "done" || status.kind === "error" ? status.message : ""}
        </span>
      </div>
    </form>
  );
}
