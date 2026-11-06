import { readFileSync } from "node:fs";
import path from "node:path";
import { createDb, schema, type Db } from "@troba/db";
import { createTestDatabase } from "@troba/db/test-database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { importPresets } from "./presets";
import type { ImportProfile } from "./profile";
import { importProfileListLimit, listImportProfiles, saveImportProfile } from "./profiles";
import { resolveImportFormat } from "./resolve";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let db: Db;
let userCount = 0;

const preset = importPresets[0];
const presetFile = readFileSync(
  path.join(import.meta.dirname, "presets", `${preset.id}.fixture.csv`),
);
const otherFile = readFileSync(
  path.join(import.meta.dirname, "../../../test/fixtures/csv/example-bank-signed.csv"),
);

async function createUser() {
  const [user] = await db
    .insert(schema.users)
    .values({ name: "Example User", email: `resolve${++userCount}@example.test` })
    .returning({ id: schema.users.id });
  return user!.id;
}

beforeAll(async () => {
  database = await createTestDatabase();
  db = createDb(database.url);
});

afterAll(async () => {
  await db.$client.end();
  await database.drop();
});

describe("resolveImportFormat", () => {
  it("copies a matching preset into the requesting user's profiles only", async () => {
    const userId = await createUser();
    const otherUserId = await createUser();

    const resolved = await resolveImportFormat(db, userId, presetFile);

    expect(resolved).toMatchObject({
      kind: "profile",
      source: "preset",
      profile: { name: preset.profile.name, columns: preset.profile.columns },
    });
    expect(await listImportProfiles(db, userId)).toEqual([
      expect.objectContaining({ name: preset.profile.name }),
    ]);
    expect(await listImportProfiles(db, otherUserId)).toEqual([]);
    expect(await db.$count(schema.moneyImportProfiles)).toBe(1);
  });

  it("uses the user's saved copy on a later upload", async () => {
    const userId = await createUser();
    const first = await resolveImportFormat(db, userId, presetFile);
    const second = await resolveImportFormat(db, userId, presetFile);

    if (first.kind !== "profile" || second.kind !== "profile") throw new Error("not resolved");
    expect(second.source).toBe("saved");
    expect(second.profile.id).toBe(first.profile.id);
    expect(await listImportProfiles(db, userId)).toHaveLength(1);
  });

  it("prefers the user's saved profile to the preset", async () => {
    const userId = await createUser();
    const mine: ImportProfile = { ...preset.profile, name: "My bank", dateFormat: "DD.MM.YYYY" };
    const saved = await saveImportProfile(db, userId, { profile: mine, bytes: presetFile });
    if (!saved.ok) throw new Error(saved.reason);

    const resolved = await resolveImportFormat(db, userId, presetFile);

    expect(resolved).toMatchObject({
      kind: "profile",
      source: "saved",
      profile: { id: saved.profile.id, name: "My bank", dateFormat: "DD.MM.YYYY" },
    });
    expect(await listImportProfiles(db, userId)).toHaveLength(1);
  });

  it("leaves a file matching neither a profile nor a preset unknown", async () => {
    const userId = await createUser();

    expect(await resolveImportFormat(db, userId, otherFile)).toEqual({
      kind: "unknown",
      reason: "no-match",
    });
    expect(await listImportProfiles(db, userId)).toEqual([]);
  });

  it("leaves a file whose headers differ from the preset's unknown", async () => {
    const userId = await createUser();
    const changed = new TextDecoder().decode(presetFile).replace('"DATA"', '"DATA 2"');

    expect(await resolveImportFormat(db, userId, new TextEncoder().encode(changed))).toEqual({
      kind: "unknown",
      reason: "no-match",
    });
    expect(await listImportProfiles(db, userId)).toEqual([]);
  });

  it("says a preset's file is unknown only because the profile limit is reached", async () => {
    const userId = await createUser();
    await db.insert(schema.moneyImportProfiles).values(
      Array.from({ length: importProfileListLimit }, (_, i) => ({
        userId,
        ...preset.profile,
        name: `Profile ${i}`,
        headerFingerprint: "x",
      })),
    );

    expect(await resolveImportFormat(db, userId, presetFile)).toEqual({
      kind: "unknown",
      reason: "profile-limit",
    });
  });
});
