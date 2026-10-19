// The organisation profile: what an agency, an IT services firm or a freelancer sells and can deliver. Proposals
// stay within it, and their work packages are priced with its day rates. Browser-safe, so the settings form and the
// requirements review use the same rules as the server.

import type { Locale } from "./locales.ts";

/** A role of the rate card, e.g. "Senior developer" at 650 a day. */
export interface ProfileRole {
  /** Stable identifier the models cite in their work packages, derived from the name (roleId). */
  id: string;
  name: string;
  /** Daily rate in the profile's currency. */
  dailyRate: number;
}

export interface HostingPolicy {
  /** Data and services hosted in the European Union only. */
  euOnly: boolean;
  /** The hosting providers the organisation works with; empty when any will do. */
  providers: string[];
  /** On-premises hosting, at the client's, is an acceptable option. */
  onPremises: boolean;
  /** Anything else about hosting, in the organisation's words. */
  notes: string;
}

export interface OrgProfile {
  name: string;
  /** Technologies the proposals should favour: a soft constraint. */
  preferredTechnologies: string[];
  /** Technologies the organisation never delivers: a hard constraint. */
  forbiddenTechnologies: string[];
  /** A hard constraint. */
  hosting: HostingPolicy;
  /** ISO 4217 code of the day rates, and of every amount of the debates that use the profile. */
  currency: string;
  roles: ProfileRole[];
  capacity: {
    /** People available to staff a project. */
    people: number | null;
    /** The size of a usual project team. */
    typicalTeamSize: number | null;
  };
  /** What every project includes, e.g. documentation, a handover session. */
  deliverables: string[];
  /** What the organisation commits to, e.g. a three-month warranty. */
  guarantees: string[];
  notes: string;
  /** When it was last saved; null before that. */
  updatedAt: string | null;
}

/** Limits of a profile, checked by the server and shown by the forms. */
export const PROFILE_LIMITS = {
  name: 120,
  item: 120,
  items: 40,
  roles: 20,
  notes: 2_000,
  maxDailyRate: 1_000_000,
  maxPeople: 100_000,
} as const;

export const EMPTY_PROFILE: OrgProfile = {
  name: "",
  preferredTechnologies: [],
  forbiddenTechnologies: [],
  hosting: { euOnly: false, providers: [], onPremises: false, notes: "" },
  currency: "EUR",
  roles: [],
  capacity: { people: null, typicalTeamSize: null },
  deliverables: [],
  guarantees: [],
  notes: "",
  updatedAt: null,
};

/** A role id from its name: lower case, accents folded, words joined by underscores. */
export function roleId(name: string): string {
  return (
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "role"
  );
}

/** Gives every role a unique id derived from its name (the second "Developer" becomes developer_2). */
export function withRoleIds(roles: Omit<ProfileRole, "id">[]): ProfileRole[] {
  const used = new Set<string>();
  return roles.map((role) => {
    const base = roleId(role.name);
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}_${n}`;
    used.add(id);
    return { id, name: role.name, dailyRate: role.dailyRate };
  });
}

/** True when the profile says something the debate can use; an untouched form is no profile at all. */
export function hasProfile(profile: OrgProfile | null | undefined): profile is OrgProfile {
  if (!profile) return false;
  return Boolean(
    profile.name.trim() ||
      profile.preferredTechnologies.length ||
      profile.forbiddenTechnologies.length ||
      profile.roles.length ||
      profile.hosting.euOnly ||
      profile.hosting.onPremises ||
      profile.hosting.providers.length ||
      profile.hosting.notes.trim() ||
      profile.deliverables.length ||
      profile.guarantees.length ||
      profile.capacity.people !== null ||
      profile.capacity.typicalTeamSize !== null ||
      profile.notes.trim(),
  );
}

/**
 * The roles the models use to estimate effort when there is no rate card: they also estimate each one's daily rate,
 * marked as an estimate. The interfaces translate their names.
 */
export const GENERIC_ROLES = ["project_manager", "architect", "senior_developer", "developer", "designer", "tester", "devops"] as const;
export type GenericRole = (typeof GENERIC_ROLES)[number];

export const isGenericRole = (id: string): id is GenericRole => (GENERIC_ROLES as readonly string[]).includes(id);

/** The currency of the debates of a language, when neither a profile nor the budget names one. */
const LOCALE_CURRENCIES: Record<Locale, string> = {
  en: "USD",
  fr: "EUR",
  es: "EUR",
  pt: "BRL",
  it: "EUR",
  de: "EUR",
  hi: "INR",
  ja: "JPY",
  "zh-Hans": "CNY",
  ar: "USD",
};

export const localeCurrency = (locale: Locale): string => LOCALE_CURRENCIES[locale] ?? "USD";

const SYMBOLS: Record<string, string> = { "€": "EUR", $: "USD", US$: "USD", "£": "GBP", "₹": "INR", "¥": "JPY", "₩": "KRW", "CHF.": "CHF" };

/**
 * The ISO 4217 codes the runtime knows, null where it cannot list them. Intl.NumberFormat accepts any three letters
 * ("DOL"), so it cannot tell a currency from a typo on its own.
 */
const KNOWN_CURRENCIES: ReadonlySet<string> | null = (() => {
  try {
    return new Set(Intl.supportedValuesOf("currency"));
  } catch {
    return null;
  }
})();

/** Every ISO 4217 code the runtime knows, sorted; empty where it cannot list them. */
export const currencyCodes = (): string[] => [...(KNOWN_CURRENCIES ?? [])].sort();

/** An ISO 4217 code from what a model or a person wrote ("eur", "€"), or null when it is not one ("DOL"). */
export function currencyCode(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const code = (SYMBOLS[trimmed] ?? trimmed).toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) return null;
  if (KNOWN_CURRENCIES) return KNOWN_CURRENCIES.has(code) ? code : null;
  try {
    new Intl.NumberFormat("en", { style: "currency", currency: code });
    return code;
  } catch {
    return null;
  }
}

interface Budget {
  build: { amount: number; currency: string } | null;
  run: { amount: number; currency: string; period: "month" | "year" } | null;
}

/** The currencies of a requirements sheet's budget that are not ISO 4217 codes, as written. */
export function unknownCurrencies(sheet: { budget: Budget }): string[] {
  return [sheet.budget.build, sheet.budget.run].flatMap((money) => (money && !currencyCode(money.currency) ? [money.currency] : []));
}

/**
 * A requirements sheet whose budget is in ISO 4217 codes: "eur" or "€" become EUR, and a currency that is not one
 * (a model's "DOL") takes the other amount's currency, else `fallback`. A model's mistake never fails a debate.
 */
export function withCurrencyCodes<T extends { budget: Budget }>(sheet: T, fallback: string): T {
  const { build, run } = sheet.budget;
  const known = currencyCode(build?.currency) ?? currencyCode(run?.currency) ?? fallback;
  return {
    ...sheet,
    budget: {
      ...sheet.budget,
      build: build ? { ...build, currency: currencyCode(build.currency) ?? known } : null,
      run: run ? { ...run, currency: currencyCode(run.currency) ?? known } : null,
    },
  };
}
