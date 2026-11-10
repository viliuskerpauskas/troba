---
status: accepted
date: 2026-11-10
decision-makers: owner
---

# SheetJS, pinned from its own CDN, reads spreadsheet statement files

## Context and Problem Statement

Some banks give statement files as XLSX, old binary XLS or ODS. troba reads a spreadsheet's first sheet into the same table a CSV gives, so import profiles, presets, AI mapping and the manual form work unchanged. Which library reads all three formats, and how are typed cells kept away from floats?

## Decision Drivers

- All three formats: XLSX, XLS and ODS
- The files are untrusted uploads
- Money never goes through a float ([ADR-0004](0004-postgresql-and-integer-money.md))
- Free/open-source, exact pinned versions (AGENTS.md)

## Considered Options

- SheetJS Community Edition, installed from the SheetJS CDN tarball
- SheetJS from the npm registry (`xlsx`)
- ExcelJS
- A separate library per format

## Decision Outcome

Chosen option: "SheetJS Community Edition, installed from the SheetJS CDN tarball", because it is the only open-source library that reads all three formats, and its maintained releases are published only there.

- The dependency is the tarball URL with an exact version, so the lockfile pins its integrity hash.
- Only the first sheet is read.
- Typed cells are normalized before any profile sees them: a number becomes its shortest round-trip decimal string (`12.5`) and a date becomes `YYYY-MM-DD`. Text cells pass through unchanged, and the profile's decimal separator and date format apply only to them. Cents are still parsed from a string. The shortest round-trip string of a double is exact for any amount a bank writes with up to two decimals.
- An import profile records its kind (text or spreadsheet) and is matched only against files of that kind.

### Consequences

- Good, because all three formats share one reader and the whole import pipeline.
- Bad, because the dependency comes from outside the npm registry, so `pnpm audit` and Dependabot don't watch it. Upgrades are checked by hand against the SheetJS release notes.
- Bad, because parsing untrusted binary formats is attack surface. The import size limit applies before parsing.

## Pros and Cons of the Options

### SheetJS from npm (`xlsx`)

- Bad, because the registry package stopped at 0.18.5, which has published vulnerabilities (prototype pollution, ReDoS).

### ExcelJS

- Good, because it is on npm and actively maintained.
- Bad, because it reads XLSX only: no XLS or ODS.

### A library per format

- Bad, because it means three dependencies and three readers for one job.

## More Information

Check the current SheetJS CE version and its CDN install instructions when adding it (https://docs.sheetjs.com/docs/getting-started/installation/nodejs).
