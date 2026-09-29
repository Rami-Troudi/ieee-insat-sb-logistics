import { createMiddleware } from "hono/factory";
import type { Context } from "hono";
import { eq } from "drizzle-orm";
import { createAuth, trustedAuthOrigin } from "./auth";
import type { CurrentUser, Env, UserRole } from "./env";
import { schema } from "./database";

export type AppContext = Context<{ Bindings: Env; Variables: { actor: CurrentUser } }>;

export async function resolveIdentity(c: AppContext): Promise<CurrentUser | null> {
  const origin = trustedAuthOrigin(c.env, c.req.url);
  const session = await createAuth(c.env, origin).api.getSession({ headers: c.req.raw.headers });
  const userId = session?.user?.id;
  if (!userId) return null;

  const [user] = await c.env.DB.select({
    id: schema.authUsers.id,
    name: schema.authUsers.name,
    email: schema.authUsers.email,
    role: schema.authUsers.role,
  })
    .from(schema.authUsers)
    .where(eq(schema.authUsers.id, userId))
    .limit(1);

  if (!user || !["USER", "BOARD", "SUPERADMIN"].includes(user.role)) return null;
  return { ...user, role: user.role as UserRole };
}

export const requireUser = createMiddleware<{
  Bindings: Env;
  Variables: { actor: CurrentUser };
}>(async (c, next) => {
  const actor = await resolveIdentity(c as AppContext);
  if (!actor)
    return c.json({ error: { code: "UNAUTHENTICATED", message: "Sign in to continue." } }, 401);
  if (actor.role !== "USER") {
    return c.json({ error: { code: "FORBIDDEN", message: "A user account is required." } }, 403);
  }
  c.set("actor", actor);
  await next();
});

export const requireBoard = createMiddleware<{
  Bindings: Env;
  Variables: { actor: CurrentUser };
}>(async (c, next) => {
  const actor = await resolveIdentity(c as AppContext);
  if (!actor)
    return c.json({ error: { code: "UNAUTHENTICATED", message: "Sign in to continue." } }, 401);
  if (actor.role !== "BOARD" && actor.role !== "SUPERADMIN") {
    return c.json({ error: { code: "FORBIDDEN", message: "Board access is required." } }, 403);
  }
  c.set("actor", actor);
  await next();
});

export const requireSuperadmin = createMiddleware<{
  Bindings: Env;
  Variables: { actor: CurrentUser };
}>(async (c, next) => {
  const actor = await resolveIdentity(c as AppContext);
  if (!actor)
    return c.json({ error: { code: "UNAUTHENTICATED", message: "Sign in to continue." } }, 401);
  if (actor.role !== "SUPERADMIN") {
    return c.json({ error: { code: "FORBIDDEN", message: "Superadmin access is required." } }, 403);
  }
  c.set("actor", actor);
  await next();
});
