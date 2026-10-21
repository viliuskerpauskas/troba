import { readFileSync } from "node:fs";
import path from "node:path";
import { createDb, schema, type Db } from "@troba/db";
import { createTestDatabase } from "@troba/db/test-database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ImportProfile } from "./profile";
import {
  getImportProfile,
  listImportProfiles,
  matchImportProfile,
  saveImportProfile,
} from "./profiles";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let db: Db;
let userCount = 0;

const fixtures = path.join(import.meta.dirname, "../../../test/fixtures/csv");
const signedFile = readFileSync(path.join(fixtures, "example-bank-signed.csv"));
const debitCreditFile = readFileSync(path.join(fixtures, "example-bank-debit-credit.csv"));

const signedProfile: ImportProfile = {
  name: "Example Bank (signed)",
  skipLines: 0,
  delimiter: null,
  encoding: "utf-8",
  decimalSeparator: ".",
  dateFormat: "DD/MM/YYYY",
  columns: { bookingDate: "Posted", amount: "Amount", ownIban: "Account" },
  debitValues: null,
};

// A preamble line above the header: matching must read the file with the profile's skip lines.
const debitCreditProfile: ImportProfile = {
  name: "Example Bank (D/C)",
  skipLines: 1,
  delimiter: ";",
  encoding: "utf-8",
  decimalSeparator: ",",
  dateFormat: "YYYY-MM-DD",
  columns: { bookingDate: "Date", amount: "Amount", debitCredit: "D/C" },
  debitValues: ["D"],
};

async function createUser() {
  const [user] = await db
    .insert(schema.users)
    .values({ name: "Example User", email: `profiles${++userCount}@example.test` })
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

describe("matchImportProfile", () => {
  it("finds the profile saved for a file's format when the next file arrives", async () => {
    const userId = await createUser();
    const signed = await saveImportProfile(db, userId, {
      profile: signedProfile,
      bytes: signedFile,
    });
    const debitCredit = await saveImportProfile(db, userId, {
      profile: debitCreditProfile,
      bytes: debitCreditFile,
    });
    expect(signed.ok && debitCredit.ok).toBe(true);

    expect(await matchImportProfile(db, userId, signedFile)).toMatchObject({
      name: "Example Bank (signed)",
    });
    expect(await matchImportProfile(db, userId, debitCreditFile)).toMatchObject({
      name: "Example Bank (D/C)",
      skipLines: 1,
      debitValues: ["D"],
    });
  });

  it("finds nothing for a format the user has no profile for", async () => {
    const userId = await createUser();
    await saveImportProfile(db, userId, { profile: signedProfile, bytes: signedFile });

    expect(await matchImportProfile(db, userId, debitCreditFile)).toBeNull();
    expect(await matchImportProfile(db, await createUser(), debitCreditFile)).toBeNull();
  });

  it("never finds another user's profile", async () => {
    const owner = await createUser();
    await saveImportProfile(db, owner, { profile: signedProfile, bytes: signedFile });

    expect(await matchImportProfile(db, await createUser(), signedFile)).toBeNull();
  });
});

describe("listImportProfiles and getImportProfile", () => {
  it("give the user their own profiles, by name, and nobody else's", async () => {
    const userId = await createUser();
    const other = await createUser();
    await saveImportProfile(db, userId, { profile: signedProfile, bytes: signedFile });
    const created = await saveImportProfile(db, userId, {
      profile: { ...debitCreditProfile, name: "Another bank" },
      bytes: debitCreditFile,
    });
    await saveImportProfile(db, other, { profile: signedProfile, bytes: signedFile });
    const profileId = created.ok ? created.profile.id : "";

    expect((await listImportProfiles(db, userId)).map((profile) => profile.name)).toEqual([
      "Another bank",
      "Example Bank (signed)",
    ]);
    expect(await getImportProfile(db, userId, profileId)).toEqual({
      ...debitCreditProfile,
      id: profileId,
      name: "Another bank",
    });
    expect(await getImportProfile(db, other, profileId)).toBeNull();
  });
});

describe("saveImportProfile", () => {
  it("refuses a profile that maps a header the file doesn't have", async () => {
    const userId = await createUser();
    const result = await saveImportProfile(db, userId, {
      profile: { ...signedProfile, columns: { ...signedProfile.columns, description: "Memo" } },
      bytes: signedFile,
    });

    expect(result).toEqual({ ok: false, reason: "missing-columns", columns: ["Memo"] });
    expect(await matchImportProfile(db, userId, signedFile)).toBeNull();
  });

  it("edits a profile in place, and a later file matches the edit", async () => {
    const userId = await createUser();
    const created = await saveImportProfile(db, userId, {
      profile: signedProfile,
      bytes: signedFile,
    });
    const profileId = created.ok ? created.profile.id : "";

    const edited = await saveImportProfile(db, userId, {
      profileId,
      profile: { ...signedProfile, name: "Example Bank", dateFormat: "MM/DD/YYYY" },
      bytes: signedFile,
    });

    expect(edited).toMatchObject({ ok: true, profile: { id: profileId, name: "Example Bank" } });
    expect(await matchImportProfile(db, userId, signedFile)).toMatchObject({
      id: profileId,
      dateFormat: "MM/DD/YYYY",
    });
  });

  it("can't edit another user's profile", async () => {
    const owner = await createUser();
    const created = await saveImportProfile(db, owner, {
      profile: signedProfile,
      bytes: signedFile,
    });
    const profileId = created.ok ? created.profile.id : "";

    const result = await saveImportProfile(db, await createUser(), {
      profileId,
      profile: { ...signedProfile, name: "Taken over" },
      bytes: signedFile,
    });

    expect(result).toEqual({ ok: false, reason: "not-found" });
    expect(await matchImportProfile(db, owner, signedFile)).toMatchObject({
      name: "Example Bank (signed)",
    });
  });
});
