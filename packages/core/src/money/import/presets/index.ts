import sebLt from "./seb-lt";

// Every built-in preset. Adding a bank is adding a data file here and its fixture beside it.
export const importPresets = [sebLt] as const;

export { definePreset, importPresetSchema, type ImportPreset } from "./define";
