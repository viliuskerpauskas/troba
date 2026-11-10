import type { Db } from "@troba/db";
import { maxImportFileBytes } from "./import";
import { headerFingerprint } from "./profile";
import { importPresets, type ImportPreset } from "./presets";
import { matchImportProfile, saveImportProfile, type SavedImportProfile } from "./profiles";
import { readTableHeaders, tableKindOf } from "./table";

// Which format an uploaded file is in (SPEC-money M3), in order: the user's saved profile, then a
// built-in preset, copied into the user's own profiles at that moment so that it behaves like any
// profile they taught troba, and their saved copy is found first from then on. Anything else is
// an unknown format, which goes to the mapping step. A preset whose copy can't be saved (the
// user's profile limit) is a known format all the same: "profile-limit", so that nothing about it
// is sent anywhere to be mapped. Profiles and presets are tried only for files of their own kind,
// a CSV or a spreadsheet (ADR-0019).

export type ResolvedImportFormat =
  | { kind: "profile"; profile: SavedImportProfile; source: "saved" | "preset" }
  | { kind: "unknown"; reason: "no-match" | "profile-limit" };

export type ResolveImportFormatOptions = {
  // The built-in presets unless a test gives others.
  presets?: readonly ImportPreset[];
};

export async function resolveImportFormat(
  db: Db,
  userId: string,
  bytes: Uint8Array,
  { presets = importPresets }: ResolveImportFormatOptions = {},
): Promise<ResolvedImportFormat> {
  const saved = await matchImportProfile(db, userId, bytes);
  if (saved) return { kind: "profile", profile: saved, source: "saved" };

  const preset = matchPreset(presets, bytes);
  if (!preset) return { kind: "unknown", reason: "no-match" };
  const copy = await saveImportProfile(db, userId, { profile: preset.profile, bytes });
  // A copy that can't be saved leaves the mapping step to say so.
  return copy.ok
    ? { kind: "profile", profile: copy.profile, source: "preset" }
    : { kind: "unknown", reason: "profile-limit" };
}

// The preset of the file's kind whose headers are the file's, read with the preset's own settings.
function matchPreset(presets: readonly ImportPreset[], bytes: Uint8Array) {
  if (bytes.byteLength > maxImportFileBytes) return null;
  const kind = tableKindOf(bytes);
  return presets.find((preset) => {
    if (preset.kind !== kind) return false;
    const table = readTableHeaders(bytes, preset.profile);
    return table.ok && headerFingerprint(table.headers) === preset.fingerprint;
  });
}
