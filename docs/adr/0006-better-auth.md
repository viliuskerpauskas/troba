---
status: accepted
date: 2026-10-11
decision-makers: owner
---

# Better Auth for authentication

## Context and Problem Statement

troba is invite-only for a few users, signs in with email and password, and later needs tokens for phone and watch clients. Which auth library? ([stack-options §6](../ideas/stack-options.md#6-auth-better-auth-), [SPEC-identity.md](../../SPEC-identity.md))

## Decision Drivers

- Self-hosted; users and sessions in our own Postgres
- Email/password as a first-class flow
- Room for passkeys, 2FA and bearer tokens later
- Actively maintained

## Considered Options

- Better Auth
- Auth.js (NextAuth)
- Lucia
- A self-hosted identity server (Keycloak, Authentik, Zitadel)

## Decision Outcome

Chosen option: "Better Auth", because it's self-hosted, stores users in our Postgres through its Drizzle adapter, supports email/password directly, and has plugins for the later needs (2FA, passkeys, bearer tokens).

### Consequences

- Good, because no external auth service; sessions live next to the data they guard.
- Good, because the same library serves cookie sessions for the web and tokens for later clients.
- Bad, because it's still a young project with frequent releases. Versions are pinned exactly, and plugin APIs are checked against current docs before the identity tasks start.
- Neutral, because invites are a custom table regardless of library.

### Confirmation

Identity tasks test sign-in, sign-out and session expiry against real Postgres. Every server action and route handler calls `requireUser()` first.

## Pros and Cons of the Options

### Auth.js

- Good, because widely known.
- Bad, because the credentials (password) flow is discouraged, and the project now has a new steward focused on existing users (see below).

### Lucia

- Bad, because deprecated as a library; it's now a learning resource.

### Keycloak / Authentik / Zitadel

- Good, because enterprise-grade and good on a CV.
- Bad, because heavy for under 10 users. Worth it only for SSO across many self-hosted apps.

## More Information

Checked 2026-10-11:

- Auth.js joined Better Auth in September 2025 and is maintained and overseen by the Better Auth team, which commits to security patches and urgent issues for existing users: <https://www.better-auth.com/blog/authjs-joins-better-auth>. On npm, `next-auth` `latest` is 4.24.15 and v5 is still `5.0.0-beta.32`.
- `better-auth` `latest` on npm is 1.7.7.
