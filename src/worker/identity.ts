import { createMiddleware } from "hono/factory";
import type { Context } from "hono";
import { and, eq, gt } from "drizzle-orm";
import { createAuth, trustedAuthOrigin } from "./auth";
import type { CurrentUser, Env, UserRole } from "./env";
import { schema } from "./database";

export type AppContext = Context<{ Bindings: Env; Variables: { actor: CurrentUser } }>;

export async function resolveIdentity(c: AppContext): Promise<CurrentUser | null> {
  let userId: string | null | undefined = null;

  try {
    const origin = trustedAuthOrigin(c.env, c.req.url, c.req.header("Origin"));
    const session = await createAuth(c.env, origin).api.getSession({ headers: c.req.raw.headers });
    userId = session?.user?.id;
  } catch {
    // If better-auth getSession throws (e.g. origin issue), fall back to DB lookup
  }

  // Fallback: extract token from cookie and check database
  if (!userId) {
    try {
      const cookieHeader = c.req.header("Cookie") || "";
      const tokenMatch = cookieHeader.match(/(?:__Secure-)?better-auth\.session_token=([^;]+)/);
      if (tokenMatch) {
        const rawVal = decodeURIComponent(tokenMatch[1]);
        const token = rawVal.split(".")[0];
        if (token) {
          const now = new Date();
          const [session] = await c.env.DB.select({
            userId: schema.authSessions.userId,
          })
            .from(schema.authSessions)
            .where(
              and(eq(schema.authSessions.token, token), gt(schema.authSessions.expiresAt, now))
            )
            .limit(1);

          if (session?.userId) {
            userId = session.userId;
          }
        }
      }
    } catch {
      // Ignore DB fallback error
    }
  }

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
