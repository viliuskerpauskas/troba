import { schema, type Db } from "@troba/db";
import { and, asc, eq, inArray } from "drizzle-orm";
import { readCsv, type ReadCsvOptions } from "./csv";
import { maxImportFileBytes } from "./import";
import { headerFingerprint, importProfileSchema, type ImportProfile } from "./profile";

// Saved import profiles (SPEC-money M3): a user teaches troba their bank's format once, and later
// uploads find it by the file's exact header set.

const { moneyImportProfiles } = schema;

export type SavedImportProfile = { id: string } & ImportProfile;

// The headers a profile's fingerprint is taken from depend on how the file is read: a preamble
// above the header, the delimiter and the encoding are the profile's own.
type ReadSettings = Pick<ImportProfile, "skipLines" | "delimiter" | "encoding">;

export type SaveImportProfileInput = {
  // Absent: a new profile. Else a candidate id from the client, checked against the user's.
  profileId?: string | null;
  profile: ImportProfile;
  // The file the profile was made for: its headers are the ones later files must have.
  bytes: Uint8Array;
};

export type SaveImportProfileResult =
  | { ok: true; profile: SavedImportProfile }
  | { ok: false; reason: "file-too-large" | "not-found" }
  | { ok: false; reason: "unknown-encoding" | "invalid-encoding" | "unterminated-quote" }
  // The profile maps a header the file doesn't have.
  | { ok: false; reason: "missing-columns"; columns: string[] };

export async function saveImportProfile(
  db: Db,
  userId: string,
  input: SaveImportProfileInput,
): Promise<SaveImportProfileResult> {
  if (input.bytes.byteLength > maxImportFileBytes) return { ok: false, reason: "file-too-large" };
  const profile = importProfileSchema.parse(input.profile);
  const table = readCsv(input.bytes, profile);
  if (!table.ok) return table;
  const missing = Object.values(profile.columns).filter((name) => !table.headers.includes(name));
  if (missing.length > 0) return { ok: false, reason: "missing-columns", columns: missing };

  const values = { ...profile, headerFingerprint: headerFingerprint(table.headers) };
  const [saved] = input.profileId
    ? await db
        .update(moneyImportProfiles)
        .set(values)
        .where(
          and(eq(moneyImportProfiles.id, input.profileId), eq(moneyImportProfiles.userId, userId)),
        )
        .returning({ id: moneyImportProfiles.id })
    : await db
        .insert(moneyImportProfiles)
        .values({ userId, ...values })
        .returning({ id: moneyImportProfiles.id });
  if (!saved) return { ok: false, reason: "not-found" };
  return { ok: true, profile: { id: saved.id, ...profile } };
}

// A user keeps one profile per bank format, so a handful; the limit only bounds the picker.
export const importProfileListLimit = 100;

// The user's profiles by name, for picking one by hand.
export async function listImportProfiles(db: Db, userId: string): Promise<SavedImportProfile[]> {
  const rows = await db
    .select()
    .from(moneyImportProfiles)
    .where(eq(moneyImportProfiles.userId, userId))
    .orderBy(asc(moneyImportProfiles.name), asc(moneyImportProfiles.id))
    .limit(importProfileListLimit);
  return rows.map(toSaved);
}

// profileId is a candidate from the client: null unless it is the user's.
export async function getImportProfile(
  db: Db,
  userId: string,
  profileId: string,
): Promise<SavedImportProfile | null> {
  const [row] = await db
    .select()
    .from(moneyImportProfiles)
    .where(and(eq(moneyImportProfiles.id, profileId), eq(moneyImportProfiles.userId, userId)));
  return row ? toSaved(row) : null;
}

// The user's profile for this file's format, or null. The file is read once per distinct way the
// user's profiles read files, and the fingerprints are looked up together.
export async function matchImportProfile(
  db: Db,
  userId: string,
  bytes: Uint8Array,
): Promise<SavedImportProfile | null> {
  if (bytes.byteLength > maxImportFileBytes) return null;
  const settings = await db
    .selectDistinct({
      skipLines: moneyImportProfiles.skipLines,
      delimiter: moneyImportProfiles.delimiter,
      encoding: moneyImportProfiles.encoding,
    })
    .from(moneyImportProfiles)
    .where(eq(moneyImportProfiles.userId, userId));

  const fingerprints = new Map<string, ReadSettings[]>();
  for (const setting of settings) {
    const read = readSettings(setting);
    const table = readCsv(bytes, read);
    if (!table.ok) continue;
    const fingerprint = headerFingerprint(table.headers);
    fingerprints.set(fingerprint, [...(fingerprints.get(fingerprint) ?? []), read]);
  }
  if (fingerprints.size === 0) return null;

  const candidates = await db
    .select()
    .from(moneyImportProfiles)
    .where(
      and(
        eq(moneyImportProfiles.userId, userId),
        inArray(moneyImportProfiles.headerFingerprint, [...fingerprints.keys()]),
      ),
    );
  // Only a profile whose own settings produced the fingerprint: the same headers read another way
  // would put the header on the wrong line.
  const matched = candidates.find((row) =>
    fingerprints.get(row.headerFingerprint)!.some((read) => sameSettings(read, readSettings(row))),
  );
  return matched ? toSaved(matched) : null;
}

function readSettings(row: {
  skipLines: number;
  delimiter: string | null;
  encoding: string;
}): ReadSettings & ReadCsvOptions {
  const profile = importProfileSchema.shape;
  return {
    skipLines: row.skipLines,
    delimiter: profile.delimiter.parse(row.delimiter),
    encoding: row.encoding,
  };
}

function sameSettings(a: ReadSettings, b: ReadSettings): boolean {
  return a.skipLines === b.skipLines && a.delimiter === b.delimiter && a.encoding === b.encoding;
}

// Rows are only written through importProfileSchema, so they parse.
function toSaved(row: typeof moneyImportProfiles.$inferSelect): SavedImportProfile {
  return { id: row.id, ...importProfileSchema.parse(row) };
}
