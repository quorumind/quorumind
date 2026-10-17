import type { ProviderSet } from "./engine.ts";
import { setModelPrice } from "./pricing.ts";
import { AnthropicProvider } from "./providers/anthropic.ts";
import { MockProvider } from "./providers/mock.ts";
import { OpenAiProvider } from "./providers/openai.ts";
import type { LlmProvider, ProviderKind } from "./providers/types.ts";
import type { Participant } from "./session.ts";

export const SEATS = ["A", "B"] as const;

export interface Lineup {
  interviewer: Participant;
  arbiter: Participant;
  seats: Record<string, Participant>;
}

type Env = Record<string, string | undefined>;

export const DEMO_LINEUP: Lineup = {
  interviewer: { provider: "mock", model: "mock" },
  arbiter: { provider: "mock", model: "mock" },
  seats: { A: { provider: "mock", model: "mock" }, B: { provider: "mock", model: "mock" } },
};

const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5-5";

function parseParticipant(spec: string): Participant {
  const [provider, ...rest] = spec.split(":");
  const model = rest.join(":");
  if (provider !== "anthropic" && provider !== "openai" && provider !== "mock") {
    throw new Error(`Unknown provider "${provider}" in "${spec}". Use anthropic:<model>, openai:<model> or mock.`);
  }
  if (provider === "mock") return { provider, model: "mock" };
  if (!model) throw new Error(`Missing model in "${spec}". Use ${provider}:<model>.`);
  return { provider, model };
}

/**
 * Reads which models play which role from the environment.
 * Returns null when no provider key is configured: only the demo is available then.
 */
export function liveLineupFromEnv(env: Env): Lineup | null {
  const hasAnthropic = Boolean(env.ANTHROPIC_API_KEY);
  const hasOpenAi = Boolean(env.OPENAI_API_KEY && env.OPENAI_MODEL);
  if (!hasAnthropic && !hasOpenAi) return null;

  if (env.OPENAI_MODEL && env.OPENAI_PRICE_INPUT && env.OPENAI_PRICE_OUTPUT) {
    setModelPrice(env.OPENAI_MODEL, { input: Number(env.OPENAI_PRICE_INPUT), output: Number(env.OPENAI_PRICE_OUTPUT) });
  }

  const anthropic: Participant | null = hasAnthropic
    ? { provider: "anthropic", model: env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL }
    : null;
  const openai: Participant | null = hasOpenAi ? { provider: "openai", model: env.OPENAI_MODEL as string } : null;
  const primary = (anthropic ?? openai) as Participant;
  // Two different vendors debate best: they do not share the same blind spots.
  const second = openai ?? primary;

  const pick = (key: string, fallback: Participant) => (env[key] ? parseParticipant(env[key] as string) : fallback);
  return {
    interviewer: pick("QUORUMIND_INTERVIEWER", primary),
    arbiter: pick("QUORUMIND_ARBITER", primary),
    seats: { A: pick("QUORUMIND_SEAT_A", primary), B: pick("QUORUMIND_SEAT_B", second) },
  };
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
      });
    case "mock":
      return new MockProvider(options.mockDelayMs === undefined ? {} : { chunkDelayMs: options.mockDelayMs });
  }
}

export function providersFor(lineup: Lineup, env: Env, options: { mockDelayMs?: number } = {}): ProviderSet {
  return {
    interviewer: providerFor(lineup.interviewer, env, options),
    arbiter: providerFor(lineup.arbiter, env, options),
    proposers: Object.fromEntries(
      Object.entries(lineup.seats).map(([seat, participant]) => [seat, providerFor(participant, env, options)]),
    ),
  };
}

function isEffort(value: unknown): value is "low" | "medium" | "high" | "xhigh" | "max" {
  return value === "low" || value === "medium" || value === "high" || value === "xhigh" || value === "max";
}
