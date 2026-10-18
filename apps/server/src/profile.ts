import { currencyCode, type OrgProfile, PROFILE_LIMITS, withRoleIds } from "@quorumind/core";
import { Hono } from "hono";
import { z } from "zod";
import type { User } from "./app.ts";
import type { BrandingStore } from "./branding.ts";
import { invalidRequest } from "./errors.ts";

const text = (max: number) => z.string().trim().max(max);
/** A list of short items, blanks and duplicates dropped. */
const items = z
  .array(text(PROFILE_LIMITS.item))
  .max(PROFILE_LIMITS.items)
  .transform((values) => [...new Set(values.filter(Boolean))]);
const count = z.number().int().min(0).max(PROFILE_LIMITS.maxPeople).nullable();

/**
 * An organisation profile as the settings forms send it. Role ids are derived from the names, so they stay unique
 * and readable by the models; the server stamps the time of the save.
 */
export const ProfileInput = z.object({
  name: text(PROFILE_LIMITS.name),
  preferredTechnologies: items,
  forbiddenTechnologies: items,
  hosting: z.object({
    euOnly: z.boolean(),
    providers: items,
    onPremises: z.boolean(),
    notes: text(PROFILE_LIMITS.notes),
  }),
  currency: z.string().transform((value, context) => {
    const code = currencyCode(value);
    if (!code) context.addIssue({ code: "custom", message: "The currency must be an ISO 4217 code such as EUR." });
    return code ?? "";
  }),
  roles: z
    .array(
      z.object({
        name: text(PROFILE_LIMITS.item).min(1),
        dailyRate: z.number().positive().max(PROFILE_LIMITS.maxDailyRate),
      }),
    )
    .max(PROFILE_LIMITS.roles),
  capacity: z.object({ people: count, typicalTeamSize: count }),
  deliverables: items,
  guarantees: items,
  notes: text(PROFILE_LIMITS.notes),
});
export type ProfileInput = z.infer<typeof ProfileInput>;

/** The profile to store from a validated input. */
export function profileFrom(input: ProfileInput, now = new Date()): OrgProfile {
  return { ...input, roles: withRoleIds(input.roles), updatedAt: now.toISOString() };
}

/** Only the known fields of a stored profile are read back, so a field removed later cannot leak into a debate. */
export function storedProfile(value: unknown, updatedAt: string | null): OrgProfile | null {
  const parsed = ProfileInput.safeParse(value);
  return parsed.success ? { ...parsed.data, roles: withRoleIds(parsed.data.roles), updatedAt } : null;
}

export interface ProfileDeps {
  branding: BrandingStore;
  ownerOf(user: User | null): string | null;
  /** True when the host keeps the profile itself (AppHooks.profile): it is then read and edited elsewhere. */
  hosted: boolean;
}

/**
 * The organisation profile of a self-hosted server, edited in its settings: one per owner, in the settings store.
 * A host that provides profiles itself answers 404 here.
 */
export function profileRoutes(deps: ProfileDeps) {
  const app = new Hono<{ Variables: { user: User | null } }>();
  const managed = () => ({ error: "not_found", message: "Profiles are managed by this server's host." }) as const;

  app.get("/api/profile", async (c) => {
    if (deps.hosted) return c.json(managed(), 404);
    return c.json({ profile: await deps.branding.profile(deps.ownerOf(c.get("user"))) });
  });

  app.put("/api/profile", async (c) => {
    if (deps.hosted) return c.json(managed(), 404);
    const body = await c.req.json().catch(() => undefined);
    if (body === undefined) return c.json({ error: "invalid_request", message: "The body is not valid JSON." }, 400);
    // A null profile removes it: the debates then follow no organisation's rules.
    const parsed = z.object({ profile: ProfileInput.nullable() }).safeParse(body);
    if (!parsed.success) return c.json(invalidRequest(parsed.error), 400);
    const profile = parsed.data.profile ? profileFrom(parsed.data.profile) : null;
    return c.json({ profile: await deps.branding.setProfile(deps.ownerOf(c.get("user")), profile) });
  });

  return app;
}
