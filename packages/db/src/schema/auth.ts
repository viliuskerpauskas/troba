import { sql } from "drizzle-orm";
import { boolean, check, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Better Auth tables (identity). Generated with Better Auth's Drizzle schema generator for our
// options (plural names, uuid ids, admin plugin), then adjusted: timestamps carry a time zone
// and role is limited to troba's two roles. Keep the column names Better Auth expects.

export const roles = ["admin", "user"] as const;
export type Role = (typeof roles)[number];

const id = () =>
  uuid("id")
    .default(sql`gen_random_uuid()`)
    .primaryKey();
const timestamptz = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => timestamptz("created_at").defaultNow().notNull();
const updatedAt = () =>
  timestamptz("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull();

export const users = pgTable(
  "users",
  {
    id: id(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").default(false).notNull(),
    image: text("image"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    // Admin plugin fields.
    role: text("role", { enum: roles }).default("user").notNull(),
    banned: boolean("banned").default(false),
    banReason: text("ban_reason"),
    banExpires: timestamptz("ban_expires"),
  },
  (table) => [check("users_role_check", sql`${table.role} in ('admin', 'user')`)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    expiresAt: timestamptz("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Part of the admin plugin's schema. troba never impersonates (SPEC-identity I6).
    impersonatedBy: text("impersonated_by"),
  },
  (table) => [index("sessions_user_id_idx").on(table.userId)],
);

export const accounts = pgTable(
  "accounts",
  {
    id: id(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamptz("access_token_expires_at"),
    refreshTokenExpiresAt: timestamptz("refresh_token_expires_at"),
    scope: text("scope"),
    // Password hash, for the "credential" provider.
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("accounts_user_id_idx").on(table.userId)],
);

export const verifications = pgTable(
  "verifications",
  {
    id: id(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamptz("expires_at").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("verifications_identifier_idx").on(table.identifier)],
);

// Invites (SPEC-identity I2). Admin data shared by all admins rather than a user-owned row: any
// admin can see and revoke any invite. Only a SHA-256 hash of the token is stored.
export const invites = pgTable("invites", {
  id: id(),
  tokenHash: text("token_hash").notNull().unique(),
  // When set, only this email can sign up with the invite.
  email: text("email"),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
  expiresAt: timestamptz("expires_at").notNull(),
  usedAt: timestamptz("used_at"),
  usedBy: uuid("used_by").references(() => users.id, { onDelete: "set null" }),
  revokedAt: timestamptz("revoked_at"),
});

// Sign-in attempts (SPEC-identity I3), for rate limiting by email and IP. A row is written before
// the password is checked and deleted when the sign-in succeeds, so the rows left are failures
// (or attempts still in progress). Rows older than the limit's window are deleted as new ones come.
export const signInAttempts = pgTable(
  "sign_in_attempts",
  {
    id: id(),
    // Lowercased, like Better Auth stores it.
    email: text("email").notNull(),
    // Null when the request carried no client address (local development without a proxy).
    ipAddress: text("ip_address"),
    createdAt: createdAt(),
  },
  (table) => [
    index("sign_in_attempts_email_idx").on(table.email, table.createdAt),
    index("sign_in_attempts_ip_address_idx").on(table.ipAddress, table.createdAt),
  ],
);
