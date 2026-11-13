import type { OrgProfile } from "@quorumind/core";
import { currencyCode, EMPTY_PROFILE, PROFILE_LIMITS } from "@quorumind/core/profile";
import { type FormEvent, useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, api, type ProfileInput } from "../api.ts";
import { failureText } from "../errors.ts";
import { sendOnShortcut } from "../formKeys.ts";
import { BusyButton } from "./BusyButton.tsx";
import { ConfirmDialog, useConfirm } from "./ConfirmDialog.tsx";
import { CurrencySelect } from "./CurrencySelect.tsx";
import { CharCounter, FieldError, fieldProps, serverField, useFieldErrors } from "./Field.tsx";
import { CrossIcon } from "./Icons.tsx";
import { LoadFailed } from "./LoadFailed.tsx";
import { ShortcutHint } from "./ShortcutHint.tsx";

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
  const fields = useFieldErrors();
  const clearing = useConfirm<null>();

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

  const update = (patch: Partial<Draft>, field?: string) => {
    setDraft((current) => ({ ...current, ...patch }));
    setStatus({ kind: "idle" });
    if (field) fields.clear(field);
  };
  const updateRole = (key: number, patch: Partial<Draft["roles"][number]>) =>
    update({ roles: draft.roles.map((role) => (role.key === key ? { ...role, ...patch } : role)) }, `${id}-rate-${key}`);

  /** The id of the field a name from the server stands for. The server counts the roles that have a name. */
  const fieldOfServer = (name: string | null): string | null => {
    if (!name) return null;
    const path = name.replace(/^profile\./, "");
    const role = /^roles\.(\d+)\.(name|dailyRate)$/.exec(path);
    if (role) {
      const named = draft.roles.filter((item) => item.name.trim());
      const found = named[Number(role[1])];
      return found ? (role[2] === "dailyRate" ? `${id}-rate-${found.key}` : `${id}-role-${found.key}`) : null;
    }
    const simple: Record<string, string> = {
      name: `${id}-name`,
      currency: `${id}-currency`,
      notes: `${id}-notes`,
      "capacity.people": `${id}-people`,
      "capacity.typicalTeamSize": `${id}-teamSize`,
    };
    return simple[path] ?? null;
  };

  const save = async (input: ProfileInput | null, message: string) => {
    setStatus({ kind: "saving" });
    try {
      const { profile } = await api.saveProfile(input);
      if (profile) setDraft(draftOf(profile));
      else setDraft(draftOf({ ...EMPTY_PROFILE, currency: defaultCurrency }));
      setSavedAt(profile?.updatedAt ?? null);
      setStatus({ kind: "done", message });
    } catch (caught) {
      const message = caught instanceof ApiError && caught.code === "invalid_request" ? t("validation.invalid") : failureText(t, caught);
      // The server names the field of the profile it refused: "profile.name", "profile.roles.0.dailyRate"…
      const target = fieldOfServer(serverField(caught));
      if (target) {
        fields.report({ [target]: message });
        setStatus({ kind: "idle" });
      } else setStatus({ kind: "error", message });
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const problems: Record<string, string> = {};
    if (!currencyCode(draft.currency)) problems[`${id}-currency`] = t("profile.currencyInvalid");
    for (const role of draft.roles) {
      if (!role.name.trim()) continue;
      const rate = Number(role.dailyRate.replace(",", "."));
      if (!Number.isFinite(rate) || rate <= 0 || role.dailyRate.trim() === "")
        problems[`${id}-rate-${role.key}`] = t("profile.rateInvalid");
    }
    for (const key of ["people", "teamSize"] as const) {
      const text = draft[key].trim();
      if (text !== "" && !(Number(text) >= 0)) problems[`${id}-${key}`] = t("validation.number");
    }
    fields.report(problems);
    setStatus({ kind: "idle" });
    if (Object.keys(problems).length > 0) return;
    void save(inputOf(draft), t("profile.saved"));
  };

  const list = (key: "preferred" | "forbidden" | "providers" | "deliverables" | "guarantees", label: string, hint?: string) => (
    <div className="field">
      <label className="field-label" htmlFor={`${id}-${key}`}>
        {label}
      </label>
      <textarea
        dir="auto"
        id={`${id}-${key}`}
        className="textarea"
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
    <form
      ref={fields.form}
      className="card stack profile-settings"
      onSubmit={onSubmit}
      onKeyDown={(event) => sendOnShortcut(event, saving)}
      aria-busy={!loaded || saving}
      noValidate
    >
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
          dir="auto"
          id={`${id}-name`}
          className="input"
          value={draft.name}
          maxLength={PROFILE_LIMITS.name}
          placeholder={t("profile.namePlaceholder")}
          {...fieldProps(`${id}-name`, fields.errors[`${id}-name`])}
          onChange={(event) => update({ name: event.target.value }, `${id}-name`)}
          disabled={!loaded}
        />
        <FieldError id={`${id}-name`} error={fields.errors[`${id}-name`]} />
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
              dir="auto"
              id={`${id}-hosting-notes`}
              className="textarea"
              rows={3}
              maxLength={PROFILE_LIMITS.notes}
              value={draft.hostingNotes}
              aria-describedby={`${id}-hosting-notes-counter`}
              onChange={(event) => update({ hostingNotes: event.target.value })}
              disabled={!loaded}
            />
            <CharCounter id={`${id}-hosting-notes`} value={draft.hostingNotes} max={PROFILE_LIMITS.notes} />
          </div>
        </div>
      </fieldset>

      <fieldset className="field profile-group">
        <legend className="field-label">{t("profile.pricing")}</legend>
        <div className="field profile-currency">
          <label className="field-label" htmlFor={`${id}-currency`}>
            {t("profile.currency")}
          </label>
          <CurrencySelect
            id={`${id}-currency`}
            value={draft.currency}
            onChange={(currency) => update({ currency }, `${id}-currency`)}
            disabled={!loaded}
            invalid={Boolean(fields.errors[`${id}-currency`])}
            describedBy={fields.errors[`${id}-currency`] ? `${id}-currency-hint ${id}-currency-error` : `${id}-currency-hint`}
          />
          <p className="field-hint" id={`${id}-currency-hint`} style={{ margin: 0 }}>
            {t("profile.currencyHint")}
          </p>
          <FieldError id={`${id}-currency`} error={fields.errors[`${id}-currency`]} />
        </div>
        <fieldset className="field profile-group profile-rates">
          <legend className="field-label">{t("profile.roles")}</legend>
          <p className="field-hint" style={{ margin: 0 }}>
            {t("profile.rolesHint")}
          </p>
          {draft.roles.map((role, index) => (
            <div className="profile-role" key={role.key}>
              <input
                dir="auto"
                className="input"
                aria-label={t("profile.role", { number: index + 1 })}
                placeholder={t("profile.rolePlaceholder")}
                maxLength={PROFILE_LIMITS.item}
                value={role.name}
                onChange={(event) => updateRole(role.key, { name: event.target.value })}
                disabled={!loaded}
              />
              <div className="profile-rate">
                <input
                  className="input mono"
                  type="number"
                  min={0}
                  step="any"
                  inputMode="decimal"
                  aria-label={t("profile.dailyRate", { number: index + 1, currency: draft.currency })}
                  placeholder={t("profile.dailyRatePlaceholder")}
                  value={role.dailyRate}
                  {...fieldProps(`${id}-rate-${role.key}`, fields.errors[`${id}-rate-${role.key}`])}
                  onChange={(event) => updateRole(role.key, { dailyRate: event.target.value })}
                  disabled={!loaded}
                />
                {/* The field's name already says the currency: the code beside it is only for the eye. */}
                <span className="profile-rate-code figure" aria-hidden="true">
                  <bdi>{draft.currency.trim().toUpperCase()}</bdi>
                </span>
              </div>
              <button
                type="button"
                className="icon-button"
                style={{ inlineSize: 24, blockSize: 24, border: 0 }}
                aria-label={t("profile.removeRole", { name: role.name || index + 1 })}
                onClick={() => update({ roles: draft.roles.filter((item) => item.key !== role.key) })}
              >
                <CrossIcon />
              </button>
              <FieldError id={`${id}-rate-${role.key}`} error={fields.errors[`${id}-rate-${role.key}`]} />
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
                {...fieldProps(`${id}-${key}`, fields.errors[`${id}-${key}`])}
                onChange={(event) => update({ [key]: event.target.value }, `${id}-${key}`)}
                disabled={!loaded}
              />
              <FieldError id={`${id}-${key}`} error={fields.errors[`${id}-${key}`]} />
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
          dir="auto"
          id={`${id}-notes`}
          className="textarea"
          rows={3}
          maxLength={PROFILE_LIMITS.notes}
          value={draft.notes}
          {...fieldProps(`${id}-notes`, fields.errors[`${id}-notes`], `${id}-notes-counter`)}
          onChange={(event) => update({ notes: event.target.value }, `${id}-notes`)}
          disabled={!loaded}
        />
        <FieldError id={`${id}-notes`} error={fields.errors[`${id}-notes`]} />
        <CharCounter id={`${id}-notes`} value={draft.notes} max={PROFILE_LIMITS.notes} />
      </div>

      <div className="row">
        <BusyButton type="submit" busy={saving} busyLabel={t("profile.saving")} disabled={!loaded}>
          {t("profile.save")}
        </BusyButton>
        {savedAt ? (
          <button
            type="button"
            className="button button-secondary"
            onClick={(event) => clearing.ask(null, event.currentTarget)}
            disabled={!loaded || saving}
          >
            {t("profile.clear")}
          </button>
        ) : null}
        <span role="status" className={status.kind === "error" ? "branding-error" : "field-hint"}>
          {status.kind === "done" || status.kind === "error" ? status.message : ""}
        </span>
      </div>
      <ShortcutHint />
      <ConfirmDialog
        confirm={clearing}
        title={t("profile.clearTitle")}
        confirmLabel={t("profile.clear")}
        errorText={(caught) => failureText(t, caught)}
        // The button that opened the dialog goes with the profile: the focus goes to the form's first field.
        focusAfter={() => document.getElementById(`${id}-name`)}
        onConfirm={async () => {
          await api.saveProfile(null);
          setDraft(draftOf({ ...EMPTY_PROFILE, currency: defaultCurrency }));
          setSavedAt(null);
          setStatus({ kind: "done", message: t("profile.cleared") });
        }}
      >
        <p style={{ margin: 0 }}>{t("profile.clearLead")}</p>
      </ConfirmDialog>
    </form>
  );
}
