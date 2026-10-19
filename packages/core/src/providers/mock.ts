import { COMPLIANCE_VERDICT, DEMO_COMPLIANCE } from "../compliance-verdict.ts";
import { DEMO_DONE, DEMO_QUESTIONS, DEMO_SCRIPT } from "../demo.ts";
import { demoAuditAnswer } from "../demo-audit.ts";
import { DEMO_RESEARCH_FINDINGS, DEMO_RESEARCH_PLAN, RESEARCH_FINDINGS } from "../research.ts";
import type { GenerateRequest, GenerateResult, LlmProvider } from "./types.ts";

export interface MockOptions {
  /** Delay between streamed chunks in milliseconds; 0 in tests. */
  chunkDelayMs?: number;
}

/** Replays the scripted demo debate, streaming it like a real model. */
export class MockProvider implements LlmProvider {
  readonly kind = "mock" as const;
  readonly model = "mock";
  private readonly chunkDelayMs: number;

  constructor(options: MockOptions = {}) {
    this.chunkDelayMs = options.chunkDelayMs ?? 18;
  }

  async generate(request: GenerateRequest, onDelta?: (text: string) => void): Promise<GenerateResult> {
    const text = JSON.stringify(this.answer(request));
    if (onDelta) {
      for (let i = 0; i < text.length; i += 24) {
        if (request.signal?.aborted) throw new Error("Aborted");
        onDelta(text.slice(i, i + 24));
        if (this.chunkDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.chunkDelayMs));
      }
    }
    return {
      text,
      model: this.model,
      usage: { inputTokens: Math.round(JSON.stringify(request.messages).length / 4), outputTokens: Math.round(text.length / 4) },
    };
  }

  private answer(request: GenerateRequest): unknown {
    const seat = request.seat ?? "A";
    // The steps of an audit are told apart by their schema: they share the tasks of a debate.
    const audit = demoAuditAnswer(request.schemaName, request.seat);
    if (audit !== undefined) return audit;
    switch (request.task) {
      case "interview":
        return request.messages.length > 1 ? DEMO_DONE : DEMO_QUESTIONS;
      case "research":
        return request.schemaName === RESEARCH_FINDINGS.name ? DEMO_RESEARCH_FINDINGS : DEMO_RESEARCH_PLAN;
      case "search":
        // A web search is not a model call: the recorded search (RecordedSearch) answers it.
        return {};
      case "proposal":
        return DEMO_SCRIPT.proposals[seat] ?? DEMO_SCRIPT.proposals.A;
      case "critique":
        return DEMO_SCRIPT.critiques[seat] ?? { speech: "No further critique.", critiques: [], questionsForUser: [] };
      case "revision":
        return DEMO_SCRIPT.revisions[seat] ?? DEMO_SCRIPT.revisions.A;
      case "probe":
        return DEMO_SCRIPT.probe;
      case "verdict":
        // With compliance requirements, the verdict carries the demo's assessment; the engine keeps the checks that apply.
        return request.schemaName === COMPLIANCE_VERDICT.name
          ? { ...DEMO_SCRIPT.verdict, compliance: DEMO_COMPLIANCE }
          : DEMO_SCRIPT.verdict;
      case "reassess":
        // A "what if" scenario is ruled on with the same schema under a name of its own.
        return {
          ...(request.schemaName.startsWith("scenario_update") ? DEMO_SCRIPT.scenario : DEMO_SCRIPT.reassessment),
          ...(request.schemaName.endsWith("_compliance") ? { compliance: DEMO_COMPLIANCE } : {}),
        };
      case "brief": {
        const audience = /reader: (\w+)/.exec(request.messages.at(-1)?.content ?? "")?.[1] as keyof typeof DEMO_SCRIPT.briefs;
        return DEMO_SCRIPT.briefs[audience] ?? DEMO_SCRIPT.briefs.cto;
      }
    }
  }
}
