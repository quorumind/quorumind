// "European models only": every role of a debate (interviewer, proposers, critics, devil's advocate, arbiter) is played
// by a model of a European provider, served from the European Union, or by a model that runs on the premises.
// Browser-safe, so the interface filters the models with the same rules as the server.

import type { Lineup, ModelOption, ParticipantLineup } from "./config.ts";
import type { ProviderKind } from "./providers/types.ts";
import type { Participant, Seat } from "./session.ts";

type Env = Record<string, string | undefined>;

/** A source of models that a European-only debate may use, and why it qualifies. */
export interface EuropeanSource {
  provider: ProviderKind;
  /** For a gateway (OpenRouter), the maker slug its model ids start with: "mistralai". */
  maker?: string;
  name: string;
  /** "eu": a European company serves the model from the EU. "on_premises": it runs where Quorumind runs. */
  hosting: "eu" | "on_premises" | "none";
  /** For a gateway, the endpoint every request is pinned to, as OpenRouter names it. */
  endpoint?: string;
  reason: string;
}

/**
 * The one list of what counts as European. Keep it short and justified: an entry is added only when both the company
 * and the place the model runs are known to be in Europe.
 */
export const EUROPEAN_SOURCES: readonly EuropeanSource[] = [
  {
    provider: "openrouter",
    maker: "mistralai",
    name: "Mistral AI",
    hosting: "eu",
    endpoint: "mistral/eu",
    reason:
      "Mistral AI is a French company (Paris). Through OpenRouter, every request is pinned to Mistral's own EU endpoint " +
      "(mistral/eu, without fallback), never to another company that hosts its open-weight models.",
  },
  {
    provider: "ollama",
    name: "Ollama",
    hosting: "on_premises",
    reason:
      "Open-weight models run by Ollama on the machine or the servers that run Quorumind: on the premises, the prompts do not " +
      "leave that infrastructure, whoever made the model. Only when Ollama listens on the machine or a private network, and " +
      "never for the models Ollama hosts itself (named …-cloud).",
  },
  {
    provider: "mock",
    name: "Demo",
    hosting: "none",
    reason: "The recorded demo calls no model.",
  },
];

/** OpenRouter's EU region: prompts and completions are processed in Europe (Business and Enterprise plans). */
export const OPENROUTER_EU_HOST = "eu.openrouter.ai";

/** Where Ollama listens unless OLLAMA_BASE_URL says otherwise: the machine itself. */
const LOCAL_OLLAMA = "http://127.0.0.1:11434";

/** An Ollama model that Ollama's hosted service runs ("gpt-oss:120b-cloud"): the prompts leave the premises. */
export function isOllamaCloudModel(model: string): boolean {
  return /[:-]cloud$/i.test(model.trim());
}

/**
 * Whether an address is on the premises: the machine itself, a private network (10/8, 172.16/12, 192.168/16, link-local,
 * the shared range VPNs use, IPv6 unique-local), or a host of the local network (a name without a dot, as Docker
 * Compose names its services, or under .local, .internal, .lan, .home.arpa).
 */
export function isOnPremisesUrl(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  } catch {
    return false;
  }
  if (host === "localhost" || host.endsWith(".localhost") || host === "host.docker.internal") return true;
  if (/\.(local|internal|lan|home\.arpa)$/.test(host)) return true;
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    const [a = 0, b = 0] = ipv4.slice(1, 3).map(Number);
    return (
      a === 127 ||
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  if (host.includes(":")) return host === "::1" || /^f[cd][0-9a-f]{0,2}:/.test(host) || /^fe[89ab][0-9a-f]?:/.test(host);
  return !host.includes(".");
}

/**
 * Whether the Ollama of this server runs on the premises: OLLAMA_BASE_URL on the machine or a private network, or
 * QUORUMIND_OLLAMA_ON_PREMISES=1 for a server the organisation runs at a public address.
 */
export function ollamaOnPremises(env: Env): boolean {
  const optIn = env.QUORUMIND_OLLAMA_ON_PREMISES?.trim().toLowerCase();
  return optIn === "1" || optIn === "true" || isOnPremisesUrl(env.OLLAMA_BASE_URL || LOCAL_OLLAMA);
}

function sourceOf(participant: Pick<Participant, "provider" | "model">): EuropeanSource | null {
  return (
    EUROPEAN_SOURCES.find(
      (source) =>
        source.provider === participant.provider && (source.maker === undefined || participant.model.startsWith(`${source.maker}/`)),
    ) ?? null
  );
}

/**
 * Whether a European-only debate may use this model. An Ollama model counts as on the premises only when it is not one
 * of Ollama's hosted models, and, given the environment, when Ollama runs on the premises; a catalog entry that says it
 * is not local is not either.
 */
export function isEuropean(participant: Pick<Participant, "provider" | "model"> & { local?: boolean }, env?: Env): boolean {
  if (participant.provider === "ollama") {
    if (isOllamaCloudModel(participant.model) || participant.local === false) return false;
    if (env && !ollamaOnPremises(env)) return false;
  }
  return sourceOf(participant) !== null;
}

/** The models of a catalog that a European-only debate may use, in the catalog's order. */
export function europeanCatalog<T extends Pick<ModelOption, "provider" | "model"> & { local?: boolean }>(catalog: T[], env?: Env): T[] {
  return catalog.filter((entry) => isEuropean(entry, env));
}

/** The OpenRouter endpoint a European-only request to this model is pinned to; null when it needs none. */
export function europeanEndpoint(participant: Pick<Participant, "provider" | "model">): string | null {
  return sourceOf(participant)?.endpoint ?? null;
}

/** Every role of a lineup, the devil's advocate included, as "provider:model". */
function everyone(lineup: ParticipantLineup): Participant[] {
  return [lineup.interviewer, lineup.arbiter, ...Object.values(lineup.seats), ...(lineup.devil ? [lineup.devil] : [])];
}

/** The models of a lineup that a European-only debate may not use, as "provider:model", without repeats. */
export function nonEuropeanModels(lineup: ParticipantLineup, env?: Env): string[] {
  return [
    ...new Set(
      everyone(lineup)
        .filter((participant) => !isEuropean(participant, env))
        .map((p) => `${p.provider}:${p.model}`),
    ),
  ];
}

/**
 * The default lineup of a European-only debate: the first European model interviews and rules, and faces a model of
 * another maker when there is one, else another model. Null when the catalog has no European model.
 */
export function europeanLineup(catalog: ModelOption[], env?: Env): Lineup | null {
  const options = europeanCatalog(catalog, env).filter((option) => option.provider !== "mock");
  const first = options[0];
  if (!first) return null;
  const makerOf = (option: ModelOption) => option.maker ?? option.provider;
  const second =
    options.find((option) => makerOf(option) !== makerOf(first)) ?? options.find((option) => option.model !== first.model) ?? first;
  const pick = (option: ModelOption): Participant => ({ provider: option.provider, model: option.model });
  const seat = (option: ModelOption): Seat => ({ ...pick(option), persona: null });
  return { interviewer: pick(first), arbiter: pick(first), seats: { A: seat(first), B: seat(second) }, devil: null };
}

/**
 * Whether European-only applies to new sessions: "default" ticks the option, "required" imposes it.
 * Self-hosted, QUORUMIND_EUROPEAN_ONLY=1 (or true) sets the default and QUORUMIND_EUROPEAN_ONLY=required imposes it.
 */
export type EuropeanPolicy = "default" | "required" | null;

export function europeanPolicyFromEnv(env: Env): EuropeanPolicy {
  const value = env.QUORUMIND_EUROPEAN_ONLY?.trim().toLowerCase();
  if (value === "required") return "required";
  return value === "1" || value === "true" ? "default" : null;
}

/** The OpenRouter address European-only requests go to: OPENROUTER_EU_BASE_URL, else the usual one. */
export function europeanOpenRouterBaseUrl(env: Env): string | undefined {
  return env.OPENROUTER_EU_BASE_URL || env.OPENROUTER_BASE_URL || undefined;
}

/**
 * How the requests of a European-only debate reach OpenRouter: "eu" through its EU region, where prompts and
 * completions stay in Europe; "global" through its global servers, which may be outside the EU; null without OpenRouter.
 */
export type EuropeanGateway = "eu" | "global" | null;

/** What a European-only session records: how its OpenRouter requests were routed, for its report. */
export interface EuropeanMode {
  gateway: EuropeanGateway;
}

export function europeanGateway(lineup: ParticipantLineup, env: Env): EuropeanGateway {
  if (!everyone(lineup).some((participant) => participant.provider === "openrouter")) return null;
  const base = europeanOpenRouterBaseUrl(env);
  if (!base) return "global";
  try {
    return new URL(base).hostname === OPENROUTER_EU_HOST ? "eu" : "global";
  } catch {
    return "global";
  }
}
