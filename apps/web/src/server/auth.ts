import { recordActivity } from "@troba/core";
import { schema } from "@troba/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { createAccessControl } from "better-auth/plugins/access";
import { admin } from "better-auth/plugins/admin";
import { defaultStatements } from "better-auth/plugins/admin/access";
import { db } from "./db";
import { env } from "./env";
import { passwordLength } from "./password-length";

export { passwordLength };

const day = 60 * 60 * 24;

// The admin plugin's default admin role can impersonate users and set their passwords. troba
// does neither (SPEC-identity I5, I6), so the admin role here leaves those permissions out.
const ac = createAccessControl(defaultStatements);
const roles = {
  admin: ac.newRole({
    user: ["create", "list", "set-role", "ban", "delete", "get", "update"],
    session: ["list", "revoke", "delete"],
  }),
  user: ac.newRole({ user: [], session: [] }),
};

function createAuth() {
  const { BETTER_AUTH_SECRET, BETTER_AUTH_URL } = env();
  return betterAuth({
    appName: "troba",
    secret: BETTER_AUTH_SECRET,
    baseURL: BETTER_AUTH_URL,
    database: drizzleAdapter(db(), { provider: "pg", schema, usePlural: true }),
    emailAndPassword: {
      enabled: true,
      // Accounts come from the admin CLI and invites (server/invite-sign-up.ts).
      disableSignUp: true,
      minPasswordLength: passwordLength.min,
      maxPasswordLength: passwordLength.max,
    },
    session: {
      // Rolling: a session used at least once a day stays alive for 30 days after last use.
      expiresIn: 30 * day,
      updateAge: day,
    },
    advanced: {
      database: { generateId: "uuid" },
      // Secure even over http://localhost, which browsers treat as a secure context.
      useSecureCookies: true,
    },
    // Last active for the admin users list (SPEC-identity I6). A session is refreshed at most
    // once a day (updateAge), so this is day-accurate. A refresh passes null when the session was
    // deleted meanwhile (disabled, password reset); Better Auth then signs the browser out.
    databaseHooks: {
      session: {
        create: { after: (session) => recordActivity(db(), session.userId) },
        update: {
          after: async (session) => {
            if (session) await recordActivity(db(), session.userId);
          },
        },
      },
    },
    plugins: [admin({ ac, roles, defaultRole: "user", adminRoles: ["admin"] }), nextCookies()],
  });
}

export type Auth = ReturnType<typeof createAuth>;

// One instance per server process, created on first use so `next build` needs no env.
const globalForAuth = globalThis as { trobaAuth?: Auth };

export function auth(): Auth {
  globalForAuth.trobaAuth ??= createAuth();
  return globalForAuth.trobaAuth;
}
