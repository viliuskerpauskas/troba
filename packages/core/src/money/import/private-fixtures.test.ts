import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readCsv } from "./csv";
import { importProfileSchema, parseRows } from "./profile";

// Real bank exports, kept only on the owner's machine in the gitignored .private/fixtures/, each
// `<name>.csv` beside the `<name>.profile.json` that reads it. Skipped wherever they're absent,
// CI included. Searched for upwards, because a worktree under .claude/worktrees/ has no .private/
// of its own and the main checkout's is the one that exists.
//
// Assertions name rows and reasons only: the rows themselves are personal.

function findPrivateFixtures(): string | null {
  for (let dir = import.meta.dirname; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, ".private", "fixtures");
    if (existsSync(candidate)) return candidate;
    if (path.dirname(dir) === dir) return null;
  }
}

const folder = findPrivateFixtures();
const exports = folder
  ? readdirSync(folder)
      .filter((file) => file.endsWith(".csv"))
      .map((file) => path.join(folder, file))
      .filter((file) => existsSync(file.replace(/\.csv$/, ".profile.json")))
  : [];

describe.skipIf(exports.length === 0)("private bank exports", () => {
  it.each(exports.map((file) => [path.basename(file), file]))(
    "parses every row of %s",
    (_, file) => {
      // The profile, plus the currency of the account the export belongs to.
      const json = JSON.parse(readFileSync(file.replace(/\.csv$/, ".profile.json"), "utf8"));
      const profile = importProfileSchema.parse(json);
      const bytes = readFileSync(file);
      // What the mapping step would guess for this file, before the profile existed.
      const guessed = readCsv(bytes, { encoding: profile.encoding });
      expect(guessed.ok && guessed.skipLines).toBe(profile.skipLines);
      if (profile.delimiter) expect(guessed.ok && guessed.delimiter).toBe(profile.delimiter);

      const table = readCsv(bytes, profile);
      if (!table.ok) throw new Error(table.reason);

      const result = parseRows(profile, table, { accountCurrency: json.accountCurrency });

      expect(result.ok ? { ok: true, failed: result.failed } : result).toEqual({
        ok: true,
        failed: [],
      });
      expect(result.ok && result.rows.length).toBe(table.rows.length);
      expect(result.ok && new Set(result.rows.map((row) => row.dedupKey)).size).toBe(
        table.rows.length,
      );
    },
  );
});
