---
status: accepted
date: 2026-10-11
decision-makers: owner
---

# Next.js App Router with domain logic in `packages/core`

## Context and Problem Statement

troba needs a logged-in web UI and an HTTP API that phone and watch clients can call later. Which web framework, and how do we keep the API usable outside the web UI? ([stack-options §2](../ideas/stack-options.md#2-web-framework-nextjs-app-router-))

## Decision Drivers

- One deployable for UI and API while the app is small
- Self-hosted on a VPS in Docker, as a long-running Node server
- Future non-web clients must reach the same logic
- Portfolio value

## Considered Options

- Next.js (App Router), self-hosted with `output: "standalone"`
- React + Vite SPA with a separate API (Hono, Fastify or NestJS)
- React Router v7 framework mode
- SvelteKit
- Angular + .NET

## Decision Outcome

Chosen option: "Next.js (App Router)", because UI, server actions and `/api/v1` route handlers ship as one container, and it's the most-hired React framework. Standalone output runs as a normal Node server, so serverless timeouts don't apply.

To keep a clean API for other clients, **domain logic lives in `packages/core`** as plain functions that take a `db` and a `userId`. Server actions and `/api/v1/*` route handlers are thin callers: authenticate, validate with Zod, delegate. Extracting a standalone API later is then a move, not a rewrite.

### Consequences

- Good, because there's one image to build, deploy and roll back.
- Good, because `packages/core` is testable without Next.js.
- Bad, because Server Components and caching are a steep mental model; pages that show user data stay dynamic.
- Bad, because majors break often and self-hosting is less documented than Vercel. Versions are pinned exactly and upgraded deliberately.
- Bad, because server actions can't be called by a phone or watch app, which is why `/api/v1` exists.

### Confirmation

Review checks that `packages/core` has no framework imports and that actions and route handlers contain no domain logic.

## Pros and Cons of the Options

### React + Vite SPA + separate API

- Good, because it gives the cleanest API for mobile and watch clients. Strongest runner-up.
- Bad, because two deployables, and SSR is lost (minor for a logged-in app).

### React Router v7 framework mode

- Good, because a simpler, web-standards data model.
- Bad, because a smaller job market.

### SvelteKit

- Good, because the best developer experience.
- Bad, because fewer jobs than React.

### Angular + .NET

- Good, because the owner is fastest in it.
- Bad, because little portfolio growth.

## More Information

Checked 2026-10-11: `next@16.4.0` is the current `latest` on npm and is what the scaffold pins.
