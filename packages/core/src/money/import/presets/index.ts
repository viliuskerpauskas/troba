import type { ImportProfile } from "../profile";
import type { PresetBrand } from "./define";
import revolut from "./revolut";
import sebLt from "./seb-lt";

// Every built-in preset. Adding a bank is adding a data file here and its fixture beside it.
export const importPresets = [sebLt, revolut] as const;

export { definePreset, importPresetSchema, type ImportPreset, type PresetBrand } from "./define";

// The badge colors of the preset a profile was copied from, found by its column mapping (a saved
// profile doesn't record where it came from, and the user may have renamed it). A profile whose
// mapping the user changed is theirs now, and gets none. Null for a preset without colors too.
export function presetBrand(profile: Pick<ImportProfile, "columns">): PresetBrand | null {
  const key = columnsKey(profile.columns);
  const preset = importPresets.find((candidate) => columnsKey(candidate.profile.columns) === key);
  return preset?.brand ?? null;
}

function columnsKey(columns: ImportProfile["columns"]): string {
  return JSON.stringify(Object.entries(columns).sort(([a], [b]) => a.localeCompare(b)));
}
