// Framing templates: what the interviewer must cover first for each kind of project.
// The text goes to the models, so it stays in English; the interface translates the names.

export type TemplateId = "saas" | "mobile" | "data_ai" | "migration" | "ecommerce";

export const TEMPLATES: Record<TemplateId, { focus: string[] }> = {
  saas: {
    focus: [
      "tenancy model and data isolation between customers",
      "sign-up, authentication and roles",
      "billing and plans",
      "expected number of accounts and active users, usage peaks",
      "integrations and public API",
      "uptime expectations and support",
    ],
  },
  mobile: {
    focus: [
      "platforms (iOS, Android) and minimum OS versions",
      "native, cross-platform or progressive web app",
      "offline use and synchronisation",
      "push notifications",
      "store publication, review delays and in-app purchases",
      "backend and account sharing with an existing website",
    ],
  },
  data_ai: {
    focus: [
      "data sources, volumes, freshness and quality",
      "personal or sensitive data and where it may be processed",
      "batch, streaming or interactive queries",
      "models: hosted APIs, open-weight or trained in-house, and their running cost",
      "how results are evaluated and monitored",
      "who consumes the output: dashboards, APIs, people",
    ],
  },
  migration: {
    focus: [
      "current system: stack, hosting, size, age and pain points",
      "what must not change for users",
      "acceptable downtime and rollback plan",
      "data migration volume and consistency",
      "licences and contracts that end or renew",
      "skills of the team that will run the target system",
    ],
  },
  ecommerce: {
    focus: [
      "catalogue size, variants and stock management",
      "payment methods, countries, currencies and taxes",
      "delivery, returns and marketplace connections",
      "traffic peaks such as sales or holidays",
      "existing tools: ERP, CRM, accounting",
      "SEO and content management",
    ],
  },
};

export const TEMPLATE_IDS = Object.keys(TEMPLATES) as TemplateId[];

export const isTemplateId = (value: unknown): value is TemplateId => typeof value === "string" && value in TEMPLATES;

/** Expert roles a debating model can play. */
export const PERSONAS = {
  cloud_architect: "a cloud architect: hosting, scalability, reliability and operations",
  security: "a security engineer: attack surface, authentication, secrets, compliance",
  finops: "a FinOps specialist: running costs, pricing models, cost traps at scale",
  ux: "a UX lead: the experience of each kind of user, accessibility, adoption",
  privacy: "a data protection lawyer: GDPR, data location, consent, contracts with processors",
} as const;
export type PersonaId = keyof typeof PERSONAS;
export const PERSONA_IDS = Object.keys(PERSONAS) as PersonaId[];

/** A preset id becomes its description; free text is kept, shortened. */
export function personaDescription(persona: string | null): string | null {
  if (!persona) return null;
  return persona in PERSONAS ? PERSONAS[persona as PersonaId] : persona.slice(0, 200);
}
