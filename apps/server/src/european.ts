import {
  type EuropeanMode,
  type EuropeanPolicy,
  europeanGateway,
  europeanLineup,
  type Lineup,
  type ModelOption,
  nonEuropeanModels,
} from "@quorumind/core";

type Env = Record<string, string | undefined>;

/** A European-only session asked for a model that is not European: answered 400 non_european_model. */
export class NonEuropeanModel extends Error {
  readonly code = "non_european_model";
  /** The first model at fault, as provider:model. */
  readonly model: string;
  constructor(models: string[]) {
    super(
      `European models only: ${models.join(", ")} ${models.length > 1 ? "are" : "is"} not from a European provider hosted in the EU, nor run on the premises.`,
    );
    this.model = models[0] ?? "";
  }
}

/** A European-only session, but this server offers no European model: answered 400 european_unavailable. */
export class EuropeanUnavailable extends Error {
  readonly code = "european_unavailable";
  constructor() {
    super("European models only: no European model is available on this server. Add Mistral models (OpenRouter) or local models (Ollama).");
  }
}

/** Whether a new session is European-only: imposed by the policy, else as asked, else the policy's default. */
export function wantsEuropean(policy: EuropeanPolicy, requested: boolean | undefined): boolean {
  if (policy === "required") return true;
  return requested ?? policy === "default";
}

/**
 * The lineup of a European-only session and what it records: the lineup asked for, refused when one of its models is not
 * European, or the European default of the catalog.
 */
export function europeanSession(lineup: Lineup | null, catalog: ModelOption[], env: Env): { lineup: Lineup; european: EuropeanMode } {
  const chosen = lineup ?? europeanLineup(catalog);
  if (!chosen) throw new EuropeanUnavailable();
  const refused = nonEuropeanModels(chosen);
  if (refused.length > 0) throw new NonEuropeanModel(refused);
  return { lineup: chosen, european: { gateway: europeanGateway(chosen, env) } };
}

/** The European-only part of /api/config: the policy, the default lineup and how OpenRouter would be reached. */
export function europeanConfig(policy: EuropeanPolicy, catalog: ModelOption[], env: Env) {
  const lineup = europeanLineup(catalog);
  return { policy, lineup, gateway: lineup ? europeanGateway(lineup, env) : null };
}
