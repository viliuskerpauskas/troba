import js from "@eslint/js";
import nextVitals from "eslint-config-next/core-web-vitals";
import prettier from "eslint-config-prettier";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores([
    "**/.next/",
    "**/.cli/",
    "**/dist/",
    "**/next-env.d.ts",
    "**/test-results/",
    "**/playwright-report/",
    ".claude/worktrees/",
    // Third-party agent skills, installed by `pnpm dlx skills add` and kept as published.
    ".claude/skills/",
  ]),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ["apps/web/**"],
    extends: [nextVitals],
    settings: { next: { rootDir: "apps/web/" } },
  },
  prettier,
]);
