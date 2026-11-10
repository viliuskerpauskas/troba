import { z } from "zod";
import { headerFingerprint, importProfileSchema } from "../profile";

// A bank preset (SPEC-money M3, ADR-0015): a built-in description of one bank's export format.
// Presets are data files in this folder, validated here by the schema a user's profile goes
// through, so a preset can't describe what a profile couldn't. Only the files in this folder
// may name a bank.

const presetFields = z.strictObject({
  // Lower-case kebab-case; also the name of the preset's fixture, `<id>.fixture.csv`.
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  // The exact header set the preset is recognized by, in the file's order.
  headers: z.array(z.string().min(1).max(200)).min(1).max(100),
  // Its name is what the user sees, on the profile they get a copy of.
  profile: importProfileSchema,
  // The bank's own colors for the profile's badge: a background and a text color on it, which
  // together must be readable (4.5:1). Hex only, since the page puts them in a style attribute.
  brand: z
    .strictObject({
      background: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      foreground: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    })
    .optional(),
});

export type PresetBrand = NonNullable<z.infer<typeof presetFields>["brand"]>;

export const importPresetSchema = presetFields.superRefine((preset, ctx) => {
  if (new Set(preset.headers).size !== preset.headers.length)
    ctx.addIssue({ code: "custom", path: ["headers"], message: "A header is listed twice." });
  const missing = Object.values(preset.profile.columns).filter(
    (name) => !preset.headers.includes(name),
  );
  if (missing.length > 0)
    ctx.addIssue({
      code: "custom",
      path: ["profile", "columns"],
      message: `The profile maps headers the preset does not recognize: ${missing.join(", ")}.`,
    });
});

export type ImportPreset = z.infer<typeof importPresetSchema> & { fingerprint: string };

// Throws on a preset that is invalid, so a broken data file fails when the module loads.
export function definePreset(input: z.input<typeof presetFields>): ImportPreset {
  const preset = importPresetSchema.parse(input);
  return { ...preset, fingerprint: headerFingerprint(preset.headers) };
}
