---
status: accepted
date: 2026-10-11
decision-makers: owner
---

# TypeScript as the only language

## Context and Problem Statement

troba needs a web UI, server logic, a background worker and, later, phone and watch clients that share types and validation. Which language should the codebase use? ([stack-options §1](../ideas/stack-options.md#1-language-typescript-))

## Decision Drivers

- One codebase that the owner and agents can work in without switching languages
- Shared types and Zod schemas between UI, server actions, `/api/v1` and the worker
- Portfolio value: matches the stack commonly hired for
- Free and open source

## Considered Options

- TypeScript everywhere
- C#/.NET backend with a TypeScript frontend
- Python backend with a TypeScript frontend

## Decision Outcome

Chosen option: "TypeScript everywhere", because one language covers web, worker, shared types and validation, and it adds the most range to the owner's existing .NET background.

### Consequences

- Good, because domain logic in `packages/core` and the schema in `packages/db` are imported directly by every app.
- Good, because Zod schemas validate at every boundary and also give the types.
- Bad, because the OCR and speech ecosystems are weaker than Python's. If receipts-ocr needs it, add one small Python service behind the worker rather than switching the main stack.

### Confirmation

`tsc -b` type-checks the whole workspace in CI (`pnpm typecheck`).

## Pros and Cons of the Options

### C#/.NET backend

- Good, because the owner knows it well and it's an excellent backend platform.
- Bad, because it splits the codebase into two languages and duplicates types across the boundary.

### Python backend

- Good, because it has the best OCR and speech libraries.
- Bad, because the same two-language split, for a benefit only one later module needs.
