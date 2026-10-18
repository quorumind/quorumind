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
      "leave that infrastructure, whoever made the model.",
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

function sourceOf(participant: Pick<Participant, "provider" | "model">): EuropeanSource | null {
  return (
    EUROPEAN_SOURCES.find(
      (source) =>
        source.provider === participant.provider && (source.maker === undefined || participant.model.startsWith(`${source.maker}/`)),
    ) ?? null
  );
}

export function isEuropean(participant: Pick<Participant, "provider" | "model">): boolean {
  return sourceOf(participant) !== null;
}

/** The models of a catalog that a European-only debate may use, in the catalog's order. */
export function europeanCatalog<T extends Pick<ModelOption, "provider" | "model">>(catalog: T[]): T[] {
  return catalog.filter(isEuropean);
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
export function nonEuropeanModels(lineup: ParticipantLineup): string[] {
  return [
    ...new Set(
      everyone(lineup)
        .filter((participant) => !isEuropean(participant))
        .map((p) => `${p.provider}:${p.model}`),
    ),
  ];
}

/**
 * The default lineup of a European-only debate: the first European model interviews and rules, and faces a model of
 * another maker when there is one, else another model. Null when the catalog has no European model.
 */
export function europeanLineup(catalog: ModelOption[]): Lineup | null {
  const options = europeanCatalog(catalog).filter((option) => option.provider !== "mock");
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
