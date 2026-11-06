import type { Db } from "@troba/db";
import { readCsvHeaders } from "./csv";
import { maxImportFileBytes } from "./import";
import { headerFingerprint } from "./profile";
import { importPresets } from "./presets";
import { matchImportProfile, saveImportProfile, type SavedImportProfile } from "./profiles";

// Which format an uploaded file is in (SPEC-money M3), in order: the user's saved profile, then a
// built-in preset, copied into the user's own profiles at that moment so that it behaves like any
// profile they taught troba, and their saved copy is found first from then on. Anything else is
// an unknown format, which goes to the mapping step.

export type ResolvedImportFormat =
  | { kind: "profile"; profile: SavedImportProfile; source: "saved" | "preset" }
  | { kind: "unknown" };

export async function resolveImportFormat(
  db: Db,
  userId: string,
  bytes: Uint8Array,
): Promise<ResolvedImportFormat> {
  const saved = await matchImportProfile(db, userId, bytes);
  if (saved) return { kind: "profile", profile: saved, source: "saved" };

  const preset = matchPreset(bytes);
  if (!preset) return { kind: "unknown" };
  const copy = await saveImportProfile(db, userId, { profile: preset.profile, bytes });
  // A copy that can't be saved (the user's profile limit) leaves the mapping step to say so.
  return copy.ok
    ? { kind: "profile", profile: copy.profile, source: "preset" }
    : { kind: "unknown" };
}

// The preset whose headers are the file's, read with the preset's own settings.
function matchPreset(bytes: Uint8Array) {
  if (bytes.byteLength > maxImportFileBytes) return null;
  return importPresets.find((preset) => {
    const table = readCsvHeaders(bytes, preset.profile);
    return table.ok && headerFingerprint(table.headers) === preset.fingerprint;
  });
}
