# Spec: identity (v1)

Status: **approved 2026-10-11**. Module id: `identity` ([capability map](SPEC.md)). Depends on: `platform`.

## Objective

Only invited people can use troba. Each user signs in securely, and **no user can ever see another user's data**. The owner administers invites and accounts but can't read anyone's financial data.

**Users:** the owner (admin) and a handful of invited friends.

**Success looks like:** a friend gets an invite link, sets a password, signs in from phone and laptop, and sees only their own data. The owner never handles anyone's password.

### User stories and acceptance criteria

**I1. Owner bootstrap**
- Public sign-up is disabled.
- The first admin is created on the server with a CLI command: `docker compose run --rm web node scripts/create-admin.js <email>`. The password is prompted, not passed as an argument.
- The command refuses to run if an admin already exists, unless `--force` is given.

**I2. Invites**
- An admin creates an invite. It can optionally be bound to an email, expires after 7 days and is single-use. The admin gets a link (`/invite/<token>`) to send however they like. troba sends no email in v1.
- Opening a valid link shows a sign-up form (name, email (pre-filled and locked if bound), password). Submitting creates the user and signs them in.
- Expired, used or unknown tokens show the same generic "invite invalid" page.
- Only a hash of the token is stored. Admins can list invites (pending/used/expired) and revoke pending ones.

**I3. Sign in / sign out**
- Email + password sign-in. The password needs at least 12 characters, with no composition rules and a max of at least 128.
- Sessions use an httpOnly, `Secure`, `SameSite=Lax` cookie, rolling for 30 days.
- Repeated failed sign-ins are rate-limited per email and per IP address, with IPv6 addresses counted by their /64 (e.g. 5 per 15 minutes). Errors don't reveal whether the email exists.
- Sign-out ends the current session. "Sign out everywhere" ends all of them.

**I4. Account settings**
- A user can change their name and password. Changing the password signs out their other sessions.
- A user can see their active sessions (device/browser, IP address, last active) and revoke them.
- A session keeps its user agent, to name the device and browser in that list, and its IP address, shown in the list too, to spot a session the user doesn't recognise. Both are personal data, so expired sessions are deleted: every sign-in and daily session refresh deletes all users' expired sessions, rather than waiting for their browser to come back. On an instance nobody uses, they wait until someone next signs in or a session refreshes.
- **Delete account:** after typing their email to confirm, all of the user's data is removed:
  - their rows, through `ON DELETE CASCADE` from every user-owned table
  - their files, by deleting `uploads/<userId>/`
  - their sessions

  This is irreversible. The last admin can't delete themselves.

**I5. Password reset (no email in v1)**
- An admin generates a single-use reset link for a user (expires after 1 hour) and sends it themselves.
- The link lets the user set a new password and signs out all their sessions.
- The admin never sees or sets the password.

**I6. Admin**
- Roles: `admin` | `user`.
- Admin pages list users (name, email, role, created, last active), create and revoke invites, generate reset links, and disable/enable users. A disabled user's sessions are revoked and sign-in is refused.
- **No impersonation.** No admin view of other users' data.

**I7. Isolation contract (for all modules)**
- `apps/web` exposes `requireUser(): { userId, role }`. Pages and server actions redirect to `/sign-in` without a session. `/api/*` routes return 401.
- `requireAdmin()` returns 403 for non-admins.
- Every domain function in `packages/core` takes `userId` explicitly and filters by it. Nothing reads the session inside `packages/core`.
- Every user-owned table has `user_id uuid not null references users(id) on delete cascade`.
- `identity` never imports other modules. Other modules seed their own defaults lazily (e.g. `ensureMoneyDefaults`) and keep files under `uploads/<userId>/`.

## Tech Stack

Better Auth with its Drizzle adapter (Postgres) and the email/password and admin (roles, ban, list users) features. Sign-in rate limiting is a small custom table (`sign_in_attempts`) in `packages/core`: sign-in runs as a server action through Better Auth's server API, which Better Auth's own rate limiter (HTTP endpoints only) doesn't cover. Invites are a small custom table plus a server action that creates the user through Better Auth's server API, with public sign-up disabled. *Verify* the current plugin APIs (`source-driven-development`) before building.

## Commands

Platform commands, plus:

```
pnpm admin:create <email>                 # local dev
docker compose run --rm web node scripts/create-admin.js <email>   # on the VPS
```

## Project Structure

```
packages/db/src/schema/auth.ts           Better Auth tables (user, session, account, verification) + invites
apps/web/lib/auth.ts                     Better Auth server config
apps/web/lib/session.ts                  requireUser(), requireAdmin()
apps/web/app/(auth)/sign-in/  invite/[token]/  reset/[token]/
apps/web/app/(app)/settings/             profile, password, sessions, delete account
apps/web/app/(app)/admin/                users, invites
apps/web/scripts/create-admin.ts
```

## Code Style

```ts
// apps/web/lib/session.ts
export async function requireUser() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.banned) redirect("/sign-in");
  return { userId: session.user.id, role: session.user.role as "admin" | "user" };
}

// apps/web/app/(app)/money/actions.ts: the pattern every module follows
export async function addTransaction(input: unknown) {
  const { userId } = await requireUser();
  return money.addTransaction(db, userId, AddTransaction.parse(input));
}
```

## Testing Strategy

| Level | Covers |
|---|---|
| Unit | Invite token hashing/expiry, `requireUser`/`requireAdmin` branches |
| Integration (real Postgres) | Invite single-use under concurrent redemption; expired and revoked invites rejected; disabled user can't sign in and their sessions are gone; delete account removes every user-owned row (an assertion that loops over all tables with `user_id`) and the uploads folder; last-admin guard |
| E2E (Playwright) | Admin creates invite → friend signs up → signs in on a second browser context → sees empty data; unauthenticated visits to `/money` redirect; non-admin gets 403 on `/admin`; rate limit kicks in after repeated bad passwords |

## Boundaries

- **Always:** call `requireUser()` first in every server action and route handler, use generic auth error messages, revoke sessions on password change/reset/disable.
- **Ask first:** adding OAuth/social login, 2FA/passkeys, sending email, changing session lifetime, adding Postgres row-level security.
- **Never:** log passwords, tokens or session ids; store raw invite/reset tokens; build impersonation or an admin data view; enable public sign-up.

## Success Criteria

1. Owner bootstrap via CLI and invite-based sign-up work end to end on staging.
2. Every user-owned table and the file route pass the cross-user isolation tests (also required by `SPEC-money.md`).
3. Delete account leaves zero rows with that `user_id` and no `uploads/<userId>/` folder.
4. The 6th wrong password within 15 minutes is refused without checking the password.
5. No auth secret, token or password appears in logs (checked by grepping test-run logs).

## Out of Scope (v1)

Email sending (verification, invites, resets), OAuth/social login, 2FA/passkeys, API tokens for phone/watch (comes with `capture`), Postgres row-level security, data export.

## Decisions (resolved 2026-10-11)

1. **2FA:** TOTP 2FA comes right after v1, as a gate before real data goes into prod.
2. **Row-level security:** v1 uses application filtering plus isolation tests. **RLS gets added after v1** (record it as an ADR when designed).
3. **Data export:** comes later, not in v1.
