import { COMPLIANCE_VERDICT, DEMO_COMPLIANCE } from "../compliance-verdict.ts";
import { DEMO_DONE, DEMO_QUESTIONS, DEMO_SCRIPT } from "../demo.ts";
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
    switch (request.task) {
      case "interview":
        return request.messages.length > 1 ? DEMO_DONE : DEMO_QUESTIONS;
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
        return DEMO_SCRIPT.reassessment;
      case "brief": {
        const audience = /reader: (\w+)/.exec(request.messages.at(-1)?.content ?? "")?.[1] as keyof typeof DEMO_SCRIPT.briefs;
        return DEMO_SCRIPT.briefs[audience] ?? DEMO_SCRIPT.briefs.cto;
      }
    }
  }
}
