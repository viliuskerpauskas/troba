import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extensionPattern, tabularFileKinds } from "./file-kinds";
import { importProfileSchema, parseRows } from "./profile";
import { readTable } from "./table";

// Real bank exports, kept only on the owner's machine in the gitignored .private/fixtures/, each
// `<name>.csv` (or another tabular kind's extension) beside the `<name>.profile.json` that reads it. Skipped wherever they're absent,
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

// A CSV or a spreadsheet statement file.
const exportFile = extensionPattern(tabularFileKinds);

const folder = findPrivateFixtures();
const exports = folder
  ? readdirSync(folder)
      .filter((file) => exportFile.test(file))
      .map((file) => path.join(folder, file))
      .filter((file) => existsSync(profileOf(file)))
  : [];

function profileOf(file: string): string {
  return file.replace(exportFile, ".profile.json");
}

describe.skipIf(exports.length === 0)("private bank exports", () => {
  it.each(exports.map((file) => [path.basename(file), file]))(
    "parses every row of %s",
    (_, file) => {
      // The profile, plus the currency of the account the export belongs to.
      const json = JSON.parse(readFileSync(profileOf(file), "utf8"));
      const profile = importProfileSchema.parse(json);
      const bytes = readFileSync(file);
      // What the mapping step would guess for this file, before the profile existed.
      const guessed = readTable(bytes, { encoding: profile.encoding });
      expect(guessed.ok && guessed.skipLines).toBe(profile.skipLines);
      if (profile.delimiter) expect(guessed.ok && guessed.delimiter).toBe(profile.delimiter);

      const table = readTable(bytes, profile);
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
