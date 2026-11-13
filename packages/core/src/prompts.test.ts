import { describe, expect, it } from "vitest";
import { AUDIT_CHECKLIST } from "./audit-constants.ts";
import { auditArbiterSystem, auditCriticSystem, auditDevilSystem, auditExtractorSystem, auditReassessSystem } from "./audit-prompts.ts";
import {
  arbiterSystem,
  briefSystem,
  challengerSystem,
  criticSystem,
  devilSystem,
  findingsSystem,
  formalizerSystem,
  interviewerSystem,
  probeSystem,
  proposerSystem,
  reassessSystem,
  researcherSystem,
  reviserSystem,
  revisionCriticSystem,
  scenarioSystem,
} from "./prompts.ts";
import { Brief, CritiqueRound, toStrictJsonSchema, Verdict } from "./schemas.ts";

const interview = { forceDone: false, express: false, template: null, challenge: false };

/** Every system prompt Quorumind sends, by role. */
const SYSTEMS: Record<string, string> = {
  interviewer: interviewerSystem("en", interview),
  proposer: proposerSystem("en", "A", null),
  critic: criticSystem("en", "A", null),
  reviser: reviserSystem("en", "A", null),
  devil: devilSystem("en", null),
  challenger: challengerSystem("en", "A", null),
  formalizer: formalizerSystem("en"),
  probe: probeSystem("en"),
  brief: briefSystem("en", "client"),
  researcher: researcherSystem("en", { maxQueries: 6, today: "2026-11-12" }),
  findings: findingsSystem("en"),
  arbiter: arbiterSystem("en", false),
  revisionCritic: revisionCriticSystem("en", null),
  reassess: reassessSystem("en", false),
  scenario: scenarioSystem("en", false),
  auditExtractor: auditExtractorSystem("en"),
  auditCritic: auditCriticSystem("en", "A", null),
  auditDevil: auditDevilSystem("en", null),
  auditArbiter: auditArbiterSystem("en", false),
  auditReassess: auditReassessSystem("en"),
};

describe("the system prompts", () => {
  it("ask every role for plain text, which the interface shows as written", () => {
    for (const [role, system] of Object.entries(SYSTEMS)) {
      expect(system, role).toContain("Every string is plain text, shown as written: no Markdown");
      expect(system, role).toContain("separate paragraphs with a blank line");
    }
  });
});

describe("the interviewer's prompt", () => {
  it("names the kind of project as a person would", () => {
    expect(interviewerSystem("en", { ...interview, template: "data_ai" })).toContain("This is a data and AI project:");
    expect(interviewerSystem("en", { ...interview, template: "saas" })).toContain("This is a SaaS project:");
    expect(interviewerSystem("en", { ...interview, template: "ecommerce" })).toContain("This is an e-commerce project:");
  });

  it("asks in plain words, the template's topics being what to find out, not words to use", () => {
    const system = interviewerSystem("en", { ...interview, template: "saas" });
    expect(system).toContain("for someone who is not a developer: use a technical term only if the person used it first");
    expect(system).toContain("cover these topics (what to find out, not words to use with the person): tenancy model");
  });
});

describe("the interviewer's limits", () => {
  const system = interviewerSystem("en", interview);

  it("says which rule wins when two pull apart", () => {
    expect(system).toContain("The limit of questions per turn wins over splitting");
    expect(system).toContain("Leave a number or a date null when neither the person nor their documents give it");
    expect(system).toContain("record a choice they left open as an assumption");
  });

  it("keeps a turn short on a phone: a short speech, and five questions at most in express", () => {
    expect(system).toContain('Start with "speech": one or two plain sentences');
    expect(interviewerSystem("en", { ...interview, express: true })).toContain("in a single turn, at most five,");
  });
});

describe("the verdict's short fields", () => {
  it("are bounded in the schema the models receive and in the arbiter's prompt", () => {
    const schema = JSON.stringify(toStrictJsonSchema(Verdict));
    expect(schema).toContain("in one sentence of at most 25 words");
    expect(schema).toContain("in at most three sentences");
    expect(schema).toContain("in at most three words");
    for (const role of ["arbiter", "reassess", "scenario", "auditArbiter", "auditReassess"]) {
      // In the prompt too: not every provider shows the model the descriptions of the schema.
      expect(SYSTEMS[role], role).toContain("Keep the short fields short: each option's reason in one sentence of at most 25 words");
    }
  });
});

describe("the open questions of a verdict", () => {
  it("are described as questions to the person, short, with what they decide", () => {
    const schema = JSON.stringify(toStrictJsonSchema(Verdict));
    expect(schema).toContain("Facts only the person or their client can supply");
    for (const role of ["arbiter", "reassess", "scenario", "auditArbiter", "auditReassess"]) {
      expect(SYSTEMS[role], role).toContain('In "openQuestions", give at most five facts that only the person or their client can tell');
      expect(SYSTEMS[role], role).toContain("one sentence of about 25 words (or the same length in your language)");
      expect(SYSTEMS[role], role).toContain("never a question the participants could settle by research, nor one for a provider");
    }
    expect(schema).toContain("one sentence of about 25 words (or the same length in your language)");
  });
});

describe("the questions the critics put to the person", () => {
  it("follow one rule: one thing, 25 words, plain words", () => {
    const rule = "Each question to the person asks one thing, in one sentence of at most 25 words, in plain words";
    for (const role of ["critic", "devil", "challenger", "auditCritic", "auditDevil"]) expect(SYSTEMS[role], role).toContain(rule);
    expect(JSON.stringify(toStrictJsonSchema(CritiqueRound))).toContain("one sentence of at most 25 words");
  });
});

describe("the profile of the organisation", () => {
  it("binds every arbiter that rules, again or on a scenario too", () => {
    const rule = "If <profile> is given, the options must be deliverable by the organisation it describes";
    for (const role of ["arbiter", "reassess", "scenario"]) expect(SYSTEMS[role], role).toContain(rule);
  });
});

describe("a brief", () => {
  it("has no speech, which nobody would read, and gives its next steps once", () => {
    expect(Object.keys(Brief.shape)).not.toContain("speech");
    expect(SYSTEMS.brief).not.toContain('"speech"');
    expect(SYSTEMS.brief).toContain("put the next steps only in nextSteps, not in a section");
  });
});

describe("the audit's prompts", () => {
  it("write the questions for the provider in the document's language, and only them", () => {
    for (const role of ["auditCritic", "auditDevil", "auditArbiter", "auditReassess"]) {
      const system = SYSTEMS[role] ?? "";
      expect(system, role).toContain(
        'the questions for the provider (a finding\'s "ask" and the audit\'s "questions") are in the language of <document>',
      );
      expect(system, role).toContain("questionsForUser and every other string stay in the language named below");
      // The language rule comes last: it states the exception itself, so that it does not override it.
      expect(system.split("\n").at(-1), role).toMatch(
        /^Write every human-readable string in English, except the quotes of <document> and the questions for the provider/,
      );
    }
    expect(SYSTEMS.auditExtractor?.split("\n").at(-1)).toMatch(
      /^Write every human-readable string in English, except the quotes of <document>\./,
    );
  });

  it("let the formalizer copy the document's figures without estimating or assuming", () => {
    expect(SYSTEMS.auditExtractor).not.toContain("Mark every figure you cannot verify as an estimate");
    expect(SYSTEMS.auditExtractor).not.toContain("state the assumption you make");
    expect(SYSTEMS.auditExtractor).toContain('Start with "speech"');
  });

  it("name the checklist once, in the critics' words and the arbiter's ids alike", () => {
    expect(SYSTEMS.auditCritic).toContain("data migration, documentation, training, maintenance and support, reversibility and exit");
    for (const role of ["auditArbiter", "auditReassess"]) {
      expect(SYSTEMS[role], role).toContain(`each item of the checklist once (${AUDIT_CHECKLIST.join(", ")})`);
    }
  });
});

describe("the interviewer's speech", () => {
  it("has one length only", () => {
    for (const express of [false, true]) {
      const system = interviewerSystem("en", { ...interview, express });
      expect(system).toContain('Start with "speech": one or two plain sentences that introduce the turn');
      expect(system).not.toContain("two to four plain sentences");
      expect(system.match(/sentences? .{0,40}speech|speech.{0,40}sentences/g)?.length ?? 0).toBe(1);
    }
  });
});

describe("the interviewer's example answers", () => {
  it("say a technical term in plain words rather than explain it", () => {
    expect(SYSTEMS.interviewer).toContain("in an example answer, say it in plain words instead");
  });
});

describe("the plain-text rule", () => {
  it("forbids Markdown marks without forbidding the symbols of C# or a dash in a sentence", () => {
    expect(SYSTEMS.critic).toContain('no bold **,\nno heading #, no "-" or "1." list marker at the start of a line');
  });
});
