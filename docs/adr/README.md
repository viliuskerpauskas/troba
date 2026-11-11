# Architecture Decision Records

Decisions in [MADR 4](https://adr.github.io/madr/) format. Copy [0000-template.md](0000-template.md) to the next free number. Supersede a decision with a new ADR rather than rewriting an accepted one.

| ADR | Decision | Status |
|---|---|---|
| [0001](0001-typescript-as-the-only-language.md) | TypeScript as the only language | accepted |
| [0002](0002-nextjs-app-router-with-core-package.md) | Next.js App Router with domain logic in `packages/core` | accepted |
| [0003](0003-pg-boss-for-background-jobs.md) | Node worker with pg-boss for background jobs | accepted |
| [0004](0004-postgresql-and-integer-money.md) | PostgreSQL, with money as integer minor units | accepted |
| [0005](0005-drizzle-orm.md) | Drizzle ORM and drizzle-kit migrations | accepted |
| [0006](0006-better-auth.md) | Better Auth for authentication | accepted |
| [0007](0007-tailwind-shadcn-base-ui.md) | Tailwind with shadcn/ui on Base UI, Recharts and Zod | accepted |
| [0008](0008-vps-docker-compose-caddy.md) | One VPS with Docker Compose and Caddy | accepted |
| [0009](0009-release-flow.md) | Release flow: Conventional Commits, release-please, one image per commit | accepted, amended by 0013 and 0014 |
| [0010](0010-vitest-and-playwright.md) | Vitest against real Postgres, and Playwright end to end | accepted |
| [0011](0011-pnpm-workspaces-monorepo.md) | pnpm workspaces monorepo with source-only packages | accepted |
| [0012](0012-matt-pocock-agent-workflow.md) | Agent workflow on Matt Pocock's engineering skills | accepted, PR and review gate superseded by 0013 |
| [0013](0013-dev-branch-to-staging.md) | Work lands on dev, which deploys to staging; main is the release branch | accepted, prod path superseded by 0014 |
| [0014](0014-merge-to-main-deploys-prod.md) | Merging into main deploys prod; release-please only versions | accepted |
| [0015](0015-import-presets-and-ai-mapping.md) | Bank names in preset data files only; a scrubbed sample of an unknown format may go to a model provider | accepted, amended by 0016 and 0018 |
| [0016](0016-ai-transaction-categorization.md) | AI suggests categories for transactions no rule matched; merchant text may go to a model provider, person names and direct transfers may not | accepted, where the call runs superseded by 0020 |
| [0017](0017-enable-banking-for-bank-sync.md) | Bank sync through Enable Banking; file import stays the primary path | rejected |
| [0018](0018-pdf-statements-read-by-a-model.md) | PDF statements are read by a model; the whole statement may go to the provider, with consent on every import | accepted |
| [0019](0019-sheetjs-for-spreadsheet-statements.md) | SheetJS, pinned from its own CDN, reads spreadsheet statement files | accepted |
| [0020](0020-ai-categorization-on-the-worker.md) | AI-suggested categories are asked for by the worker; no request waits on the model | accepted |

Background and rejected alternatives: [docs/ideas/stack-options.md](../ideas/stack-options.md).
