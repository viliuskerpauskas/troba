# Stack options: pros, cons, alternatives

Input for the ADRs in `docs/adr/`. Constraints from [intent](../intent/personal-hub.md): free/OSS tools, self-hosted VPS, multi-user, phone + later watch/voice clients, portfolio/hireability matters, owner knows Angular, .NET and Postgres.

Items marked *verify* are about fast-moving projects. Check their current docs (`source-driven-development`) before writing the ADR.

---

## 1. Language: TypeScript ✅

- **Pro:** One language for web, worker, shared types and validation. Matches the target hireable stack.
- **Con:** Weaker than Python for OCR/ML later.
- **Alternatives**
  - **C#/.NET:** You know it well and it's excellent for backends. It splits the codebase into two languages and adds less range to a CV that already has it.
  - **Python:** Best OCR/speech ecosystem. Better added later as one small OCR service than used as the main stack.

## 2. Web framework: Next.js (App Router) ✅

- **Pro:** Most-hired React framework. UI, server actions and API route handlers ship as one deployable. Self-hosting with `output: "standalone"` in Docker is a normal long-running Node server, so serverless timeouts don't apply.
- **Con:** Server Components and caching are a steep mental model. Breaking changes between majors are frequent. Self-hosting is less documented than Vercel. Server actions are tied to the web UI and can't be called from a watch or phone app.
- **Mitigation:** Keep domain logic in a plain `packages/core` (functions that take a db). Server actions and `/api/v1/*` route handlers are thin callers of it. Extracting a standalone API later is then a move, not a rewrite.
- **Alternatives**
  - **React + Vite SPA + separate API (Hono/Fastify/NestJS):** Gives the cleanest API for mobile/watch clients. Costs two deployables and loses SSR, which matters little for a logged-in app. This is the strongest runner-up.
  - **React Router v7 (Remix) framework mode:** Simpler, web-standards data model, but smaller job market.
  - **SvelteKit:** Best developer experience, but fewer jobs than React.
  - **Angular + .NET:** Fastest for you, with little portfolio growth.

## 3. Background jobs: Node worker + pg-boss ✅

- **Pro:** The queue lives in Postgres, so there's no extra service. Supports retries, cron schedules and singleton jobs, which covers imports, OCR, bank sync and voice.
- **Con:** Lower throughput than Redis queues, which doesn't matter at this scale. Smaller community.
- **Alternatives**
  - **Graphile Worker:** Also Postgres-based and very fast. Either works.
  - **BullMQ + Redis:** More features and a dashboard, but one more container to run and back up.
  - **Temporal:** Overkill.
  - **Plain cron:** No retries.

## 4. Database: PostgreSQL ✅

- **Pro:** You know it. Window functions and aggregates suit the category and price-history queries. JSONB holds raw import rows.
- **Con:** One more service to run and back up compared with SQLite.
- **Alternatives:** **SQLite** is simpler, but it's awkward with a separate worker process and multiple users.
- **Rule:** Store money as integer minor units (cents), never float, with a currency column. Why:
  - Floats can't represent most decimals exactly. In JS, `0.1 + 0.2 === 0.30000000000000004`. Summing thousands of transactions drifts by cents, so a monthly total won't match the bank statement.
  - `numeric` is exact in Postgres, but the `pg` driver returns it as a string, so you'd parse it in JS and hit floats again. Integer cents (`bigint`/`integer`) stay exact everywhere and sum correctly in SQL and JS. Format only for display: `(cents / 100).toFixed(2)` or `Intl.NumberFormat`.
  - Currency column: travel, online purchases and multi-currency accounts bring amounts in other currencies. Without the column, 10.00 USD and 10.00 EUR are indistinguishable.

## 5. ORM: Drizzle ✅

- **Pro:** Reads like SQL, so your Postgres knowledge transfers. Typed results, lightweight, migrations through `drizzle-kit`. Fine with Next.js and the worker sharing `packages/db`.
- **Con:** Younger, and its API is still moving (*verify* the current major). Relations and the query API are less polished than Prisma's.
- **Alternatives**
  - **Prisma:** Mature, great docs, highly hireable. Its own schema language hides more SQL.
  - **Kysely:** Excellent typed query builder, but migrations and schema are more DIY.
  - **Raw `pg` + SQL:** Maximum control, no type safety.

## 6. Auth: Better Auth ✅

- **Pro:** Self-hosted. Email/password, sessions, OAuth and passkeys. Stores users in your own Postgres through a Drizzle adapter. Its bearer/API-token plugins fit future phone/watch clients.
- **Con:** Young project.
- **Alternatives**
  - **Auth.js:** Widely known, but the credentials (password) flow is discouraged, and project stewardship changed in 2025 (*verify* current status).
  - **Lucia:** Deprecated as a library and now a learning resource.
  - **Keycloak / Authentik / Zitadel:** Self-hosted identity servers with an enterprise feel that looks good on a CV. Heavy for under 10 users. Consider one only if you want "SSO across many self-hosted apps".

## 7. UI: Tailwind + shadcn/ui on Base UI ✅

| Library | Model | Pro | Con |
|---|---|---|---|
| **shadcn/ui** | Components copied into your repo, built on Radix or Base UI (chosen at setup) + Tailwind | You own the code, accessible, the default in React job posts and examples, has chart and data-table recipes | You maintain the copied code; it's a starting point, not a finished design |
| **React Aria Components** (Adobe) | Headless, you style with Tailwind | Best accessibility and i18n, strong date pickers (good for finance) | More styling work, more verbose |
| **Base UI** (MUI team) | Headless, you style with Tailwind | Modern successor to Radix-style primitives, actively maintained | Newer, fewer ready-made examples |
| **HeroUI** (ex-NextUI) | Styled components on Tailwind | Looks good out of the box, quick | Less control, smaller community |
| **daisyUI** | Tailwind class plugin, no JS | Tiny, fast to prototype | No behavior (dialogs, comboboxes and focus handling are up to you) |
| **Mantine** | Styled, CSS modules (not Tailwind) | Most batteries included: tables, forms, dates, charts | Fights Tailwind; drops the Tailwind choice |

Excluded: Tailwind Plus/Catalyst, because it's paid.

- **Chosen:** shadcn/ui on Base UI ✅ (pick Base UI explicitly at `shadcn init`; sources disagree on the default).
- **Charts:** Recharts (what shadcn charts wrap).
- **Shared validation:** Zod, used by forms, server actions and API routes alike.

## 8. Testing

- **Recommendation:** Vitest (unit), Testcontainers or a Compose Postgres in CI (integration against real Postgres), Playwright (end-to-end against staging-like builds).
- **Alternative:** Jest, which is slower and more config-heavy with ESM/TS.

## 9. Monorepo

- **Recommendation:** pnpm workspaces. Add **Turborepo** (free, local cache) only once builds get slow.
- **Alternatives**
  - **Nx:** Angular-familiar, powerful, more config.
  - **npm workspaces:** Slower, looser dependency isolation.

## 10. Hosting and deploy

- **Recommendation:** One VPS running Docker Compose, with **Caddy** as the reverse proxy (automatic HTTPS, about 5 lines of config per subdomain). Staging and prod run as separate Compose projects with separate databases.
- **Alternatives**
  - **Traefik:** Label-based, more moving parts.
  - **Nginx:** Manual certificates.
  - **Coolify / Dokploy:** Free self-hosted PaaS. Fast, but it hides the pipeline you want to learn.
  - **k3s:** A Kubernetes line on the CV, overkill for this. Possible later as a learning exercise.
- **Backups (out of v1 scope, but a gate before real data goes into prod):** Nightly `pg_dump` plus receipt files backed up off-VPS (e.g. restic to a second location). This is financial data, so losing the VPS must not lose it.

## 11. Receipt storage

- **Recommendation:** Files on a Docker volume, with metadata in Postgres. Check uploads at the boundary: size limit, allowed MIME types, files served only to their owner.
- **Alternatives:** Use S3-compatible storage (Garage, SeaweedFS, MinIO, *verify* MinIO's community-edition status) once there's more than one app server.

## 12. Later modules (decide when you get there)

| Need | Free/self-hosted | Trade-off |
|---|---|---|
| Receipt OCR | Tesseract (weak on receipts), PaddleOCR (better, Python service) | An LLM vision API is the most accurate but costs money and sends data out |
| Voice to entry | whisper.cpp / faster-whisper on the VPS, then rules or a small LLM to classify | CPU-heavy on a small VPS |
| Bank sync | Licensed open-banking aggregators (*verify* providers, free tiers and new-signup availability when the time comes) | Data passes through the aggregator. Consents expire about every 180 days. |
| Observability | pino logs → Grafana + Loki (free) | Skip until after v1 |
