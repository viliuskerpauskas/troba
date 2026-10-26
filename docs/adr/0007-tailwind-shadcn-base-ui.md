---
status: accepted
date: 2026-10-11
decision-makers: owner
---

# Tailwind with shadcn/ui on Base UI, Recharts and Zod

## Context and Problem Statement

troba needs accessible forms, dialogs, tables and charts that work on a phone, without paid component kits. Which UI approach? ([stack-options §7](../ideas/stack-options.md#7-ui-tailwind--shadcnui-on-base-ui-))

## Decision Drivers

- Accessible by default (keyboard, focus, screen readers)
- Full control over markup and styling
- Chart and data-table recipes for the money views
- Free; the default in React examples and job posts

## Considered Options

- shadcn/ui on Base UI, with Tailwind
- shadcn/ui on Radix, with Tailwind
- React Aria Components
- HeroUI
- daisyUI
- Mantine

## Decision Outcome

Chosen option: "shadcn/ui on Base UI, with Tailwind", because components are copied into the repo and owned by us, built on maintained accessible primitives, and shadcn ships chart (Recharts) and data-table recipes.

Alongside it:

- **Charts:** Recharts, which shadcn's chart components wrap.
- **Validation:** Zod, shared by forms, server actions and `/api/v1`.

### Consequences

- Good, because we can change any component without fighting a library.
- Good, because Base UI is shadcn's current default, so docs and generated code match.
- Bad, because we maintain the copied code; it's a starting point, not a finished design.
- Bad, because some community examples still assume Radix (`asChild` instead of `render`, different Select value handling) and need translating.

### Confirmation

`components.json` in `apps/web` records the Base UI flavor (a `base-*` style). Accessibility is checked in the v1 end-to-end task.

## Pros and Cons of the Options

### shadcn/ui on Radix

- Good, because the most existing examples.
- Bad, because no longer the default for new projects.

### React Aria Components

- Good, because the best accessibility, i18n and date pickers.
- Bad, because more styling work and more verbose. Now also offered as a shadcn base, so it stays an option per component.

### HeroUI

- Good, because it looks good out of the box.
- Bad, because less control and a smaller community.

### daisyUI

- Good, because tiny and fast to prototype.
- Bad, because no behavior: dialogs, comboboxes and focus handling are up to us.

### Mantine

- Good, because the most batteries included.
- Bad, because it uses CSS modules and fights Tailwind.

Excluded: Tailwind Plus / Catalyst (paid).

## More Information

Checked 2026-10-11: since July 2026 `shadcn init` defaults to Base UI; Radix stays supported with `-b radix` ([changelog](https://ui.shadcn.com/docs/changelog/2026-07-base-ui-default)). This settles the stack-options note that sources disagreed on the default; pass the Base UI choice explicitly anyway in any scripted init. On npm, `shadcn` is 4.21.4 and `@base-ui/react` is 1.9.0.

Set up 2026-10-26 (T117) with `shadcn` 4.22.1 and the `base-nova` style. Two details came with it:

- Its components merge classes with `cn`, shadcn's own package that replaces clsx and tailwind-merge.
- The shadcn CLI is not a dependency: the state variants its stylesheet adds are copied into `apps/web/src/app/globals.css`, and components are added with `pnpm dlx shadcn@<version> add`, run from `apps/web`.
