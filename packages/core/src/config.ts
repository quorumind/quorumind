import type { ProviderSet } from "./engine.ts";
import { setModelPrice } from "./pricing.ts";
import { AnthropicProvider } from "./providers/anthropic.ts";
import { GeminiProvider } from "./providers/gemini.ts";
import type { FetchLike } from "./providers/http.ts";
import { MockProvider } from "./providers/mock.ts";
import { DEFAULT_OLLAMA_BASE_URL, OllamaProvider } from "./providers/ollama.ts";
import { OpenAiProvider } from "./providers/openai.ts";
import type { LlmProvider, ProviderKind } from "./providers/types.ts";
import type { Participant, Seat } from "./session.ts";

export const SEATS = ["A", "B"] as const;

export interface Lineup {
  interviewer: Participant;
  arbiter: Participant;
  seats: Record<string, Seat>;
  /** Devil's advocate: attacks every option and proposes nothing. Null when absent. */
  devil: Seat | null;
}

/** The participants of a lineup, as `providersFor` needs them (sessions store no personas). */
export interface ParticipantLineup {
  interviewer: Participant;
  arbiter: Participant;
  seats: Record<string, Participant>;
  devil?: Participant | null;
}

/** A model the person can pick for a role. */
export interface ModelOption {
  provider: ProviderKind;
  model: string;
  label: string;
  /** True when the model runs on this machine: nothing leaves it. */
  local: boolean;
}

/** The engine's providers, plus the devil's advocate. */
export type ProviderSetV1 = ProviderSet & { devil: LlmProvider | null };

type Env = Record<string, string | undefined>;

const mock = (): Seat => ({ provider: "mock", model: "mock", persona: null });

// The recorded demo shows the V1 cast: two experts and a devil's advocate.
export const DEMO_LINEUP: Lineup = {
  interviewer: { provider: "mock", model: "mock" },
  arbiter: { provider: "mock", model: "mock" },
  seats: { A: { ...mock(), persona: "cloud_architect" }, B: { ...mock(), persona: "finops" } },
  devil: mock(),
};

const DEFAULT_ANTHROPIC_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"];
const PROVIDERS: readonly ProviderKind[] = ["anthropic", "openai", "gemini", "ollama", "mock"];
const VENDOR_NAMES: Record<ProviderKind, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  gemini: "Gemini",
  ollama: "Ollama",
  mock: "Demo",
};
const OLLAMA_DISCOVERY_TIMEOUT_MS = 1_500;
const FREE = { input: 0, output: 0 };

/** QUORUMIND_LOCAL_ONLY=1: only Ollama models, so no data leaves the machine. */
export function isLocalOnly(env: Env): boolean {
  return env.QUORUMIND_LOCAL_ONLY === "1" || env.QUORUMIND_LOCAL_ONLY === "true";
}

function list(...values: (string | undefined)[]): string[] {
  const models = values.flatMap((value) => (value ?? "").split(",")).map((model) => model.trim());
  return [...new Set(models.filter(Boolean))];
}

function labelFor(provider: ProviderKind, model: string): string {
  const claude = /^claude-([a-z]+)-(\d+)-(\d+)$/.exec(model);
  if (provider === "anthropic" && claude) {
    const [, family = "", major, minor] = claude;
    return `Claude ${family.charAt(0).toUpperCase()}${family.slice(1)} ${major}.${minor}`;
  }
  return `${model} (${VENDOR_NAMES[provider]})`;
}

function option(provider: ProviderKind, model: string): ModelOption {
  return { provider, model, label: labelFor(provider, model), local: provider === "ollama" || provider === "mock" };
}

function registerPrices(models: string[], input: string | undefined, output: string | undefined) {
  if (!input || !output) return;
  const price = { input: Number(input), output: Number(output) };
  if (!Number.isFinite(price.input) || !Number.isFinite(price.output)) return;
  for (const model of models) setModelPrice(model, price);
}

/** Models known from the environment alone, without asking a local Ollama what it has. */
function staticCatalog(env: Env): ModelOption[] {
  const options: ModelOption[] = [];
  if (!isLocalOnly(env)) {
    if (env.ANTHROPIC_API_KEY) {
      const models = list(env.ANTHROPIC_MODEL, env.ANTHROPIC_MODELS || DEFAULT_ANTHROPIC_MODELS.join(","));
      options.push(...models.map((model) => option("anthropic", model)));
    }
    const openai = list(env.OPENAI_MODEL, env.OPENAI_MODELS);
    if (env.OPENAI_API_KEY && openai.length > 0) {
      registerPrices(openai, env.OPENAI_PRICE_INPUT, env.OPENAI_PRICE_OUTPUT);
      options.push(...openai.map((model) => option("openai", model)));
    }
    const gemini = list(env.GEMINI_MODEL, env.GEMINI_MODELS);
    if (env.GEMINI_API_KEY && gemini.length > 0) {
      registerPrices(gemini, env.GEMINI_PRICE_INPUT, env.GEMINI_PRICE_OUTPUT);
      options.push(...gemini.map((model) => option("gemini", model)));
    }
  }
  for (const model of list(env.OLLAMA_MODELS)) {
    setModelPrice(model, FREE);
    options.push(option("ollama", model));
  }
  return options;
}

function ollamaEnabled(env: Env): boolean {
  return Boolean(env.OLLAMA_BASE_URL || env.OLLAMA_MODELS) || isLocalOnly(env);
}

async function discoverOllamaModels(baseUrl: string, fetchImpl: FetchLike): Promise<string[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OLLAMA_DISCOVERY_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${baseUrl.replace(/\/+$/, "")}/api/tags`, { signal: controller.signal });
    if (!response.ok) return [];
    const body = (await response.json()) as { models?: { name?: string; model?: string }[] };
    return list(...(body.models ?? []).map((model) => model.name ?? model.model));
  } catch {
    // Ollama is optional: when it is not running, its models are simply not offered.
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Lists every model the configured providers offer, in vendor order: Anthropic, OpenAI,
 * Gemini, then local Ollama models. Without OLLAMA_MODELS, asks Ollama what it has pulled.
 */
export async function catalogFromEnv(env: Env, fetchImpl: FetchLike = fetch): Promise<ModelOption[]> {
  const options = staticCatalog(env);
  if (ollamaEnabled(env) && !env.OLLAMA_MODELS) {
    for (const model of await discoverOllamaModels(env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_BASE_URL, fetchImpl)) {
      setModelPrice(model, FREE);
      options.push(option("ollama", model));
    }
  }
  return options;
}

function parseParticipant(spec: string): Participant {
  const [provider, ...rest] = spec.split(":");
  const model = rest.join(":");
  if (!PROVIDERS.includes(provider as ProviderKind)) {
    throw new Error(
      `Unknown provider "${provider}" in "${spec}". Use anthropic:<model>, openai:<model>, gemini:<model>, ollama:<model> or mock.`,
    );
  }
  const kind = provider as ProviderKind;
  if (kind === "mock") return { provider: kind, model: "mock" };
  if (!model) throw new Error(`Missing model in "${spec}". Use ${kind}:<model>.`);
  return { provider: kind, model };
}

/**
 * Reads which models play which role from the environment, choosing defaults from the
 * catalog (the models configured in the environment when no catalog is given).
 * Returns null when no model is available: only the demo can run then.
 */
export function liveLineupFromEnv(env: Env, catalog?: ModelOption[]): Lineup | null {
  const localOnly = isLocalOnly(env);
  const options = (catalog ?? staticCatalog(env)).filter((entry) => entry.provider !== "mock" && (!localOnly || entry.local));
  const primaryOption = options[0];
  if (!primaryOption) return null;

  const primary: Participant = { provider: primaryOption.provider, model: primaryOption.model };
  // Two different vendors debate best: they do not share the same blind spots. Local models
  // all come from Ollama, so there a different model family is the next best thing.
  const secondOption =
    options.find((entry) => entry.provider !== primary.provider) ??
    (primary.provider === "ollama" ? options.find((entry) => entry.model !== primary.model) : undefined) ??
    primaryOption;
  const second: Participant = { provider: secondOption.provider, model: secondOption.model };

  const pick = (key: string, fallback: Participant): Participant => {
    const spec = env[key];
    if (!spec) return fallback;
    const participant = parseParticipant(spec);
    if (localOnly && participant.provider !== "ollama" && participant.provider !== "mock") {
      throw new Error(`${key}=${spec} is not allowed with QUORUMIND_LOCAL_ONLY=1: only ollama:<model> runs locally.`);
    }
    return participant;
  };
  const seat = (key: string, fallback: Participant): Seat => ({ ...pick(key, fallback), persona: null });

  const seats: Record<string, Seat> = { A: seat("QUORUMIND_SEAT_A", primary), B: seat("QUORUMIND_SEAT_B", second) };
  if (env.QUORUMIND_SEAT_C) seats.C = seat("QUORUMIND_SEAT_C", primary);
  if (env.QUORUMIND_SEAT_D) seats.D = seat("QUORUMIND_SEAT_D", primary);
  const devilSpec = env.QUORUMIND_DEVIL?.trim();

  const lineup: Lineup = {
    interviewer: pick("QUORUMIND_INTERVIEWER", primary),
    arbiter: pick("QUORUMIND_ARBITER", primary),
    seats,
    devil: devilSpec && devilSpec !== "none" ? seat("QUORUMIND_DEVIL", primary) : null,
  };
  for (const participant of [lineup.interviewer, lineup.arbiter, ...Object.values(seats), lineup.devil]) {
    if (participant?.provider === "ollama") setModelPrice(participant.model, FREE);
  }
  return lineup;
}

export function providerFor(participant: Participant, env: Env, options: { mockDelayMs?: number } = {}): LlmProvider {
  const kind: ProviderKind = participant.provider;
  switch (kind) {
    case "anthropic":
      return new AnthropicProvider({
        model: participant.model,
        ...(env.ANTHROPIC_API_KEY ? { apiKey: env.ANTHROPIC_API_KEY } : {}),
        ...(isEffort(env.ANTHROPIC_EFFORT) ? { effort: env.ANTHROPIC_EFFORT } : {}),
      });
    case "openai":
      return new OpenAiProvider({
        model: participant.model,
        ...(env.OPENAI_API_KEY ? { apiKey: env.OPENAI_API_KEY } : {}),
        ...(env.OPENAI_BASE_URL ? { baseURL: env.OPENAI_BASE_URL } : {}),
        reasoning: env.OPENAI_REASONING === "1",
      });
    case "gemini":
      return new GeminiProvider({
        model: participant.model,
        ...(env.GEMINI_API_KEY ? { apiKey: env.GEMINI_API_KEY } : {}),
        ...(env.GEMINI_BASE_URL ? { baseUrl: env.GEMINI_BASE_URL } : {}),
      });
    case "ollama":
      // Local models cost nothing, whatever their name.
      setModelPrice(participant.model, FREE);
      return new OllamaProvider({
        model: participant.model,
        ...(env.OLLAMA_BASE_URL ? { baseUrl: env.OLLAMA_BASE_URL } : {}),
      });
    case "mock":
      return new MockProvider(options.mockDelayMs === undefined ? {} : { chunkDelayMs: options.mockDelayMs });
  }
}

export function providersFor(lineup: ParticipantLineup, env: Env, options: { mockDelayMs?: number } = {}): ProviderSetV1 {
  return {
    interviewer: providerFor(lineup.interviewer, env, options),
    arbiter: providerFor(lineup.arbiter, env, options),
    proposers: Object.fromEntries(
      Object.entries(lineup.seats).map(([seat, participant]) => [seat, providerFor(participant, env, options)]),
    ),
    devil: lineup.devil ? providerFor(lineup.devil, env, options) : null,
  };
}

function isEffort(value: unknown): value is "low" | "medium" | "high" | "xhigh" | "max" {
  return value === "low" || value === "medium" || value === "high" || value === "xhigh" || value === "max";
}
