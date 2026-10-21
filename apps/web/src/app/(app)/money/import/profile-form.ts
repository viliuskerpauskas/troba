import { importProfileSchema, type ImportField, type ImportProfile } from "@troba/core";
import { importFields } from "./fields";

// The mapping form's fields ↔ an import profile. The form keeps a column's header under
// "column.<field>", "" for unmapped; delimiter "detect" for none fixed and "tab" for a tab (a
// tab doesn't survive as an option value); debit values comma-separated.

export type ProfileFormValues = Record<string, string>;

const fieldNames = Object.keys(importFields) as ImportField[];
const formNames = new Set([
  "name",
  "skipLines",
  "delimiter",
  "encoding",
  "decimalSeparator",
  "dateFormat",
  "debitValues",
  ...fieldNames.map((field) => `column.${field}`),
]);

// Null when the form isn't a valid profile, including a column field it doesn't know.
export function profileFromForm(formData: FormData): ImportProfile | null {
  for (const name of formData.keys()) {
    if (name.startsWith("column.") && !formNames.has(name)) return null;
  }
  const text = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value : "";
  };
  const delimiter = text("delimiter");
  const debitValues = text("debitValues")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const skipLines = text("skipLines").trim();

  const parsed = importProfileSchema.safeParse({
    name: text("name"),
    skipLines: /^\d{1,3}$/.test(skipLines) ? Number(skipLines) : null,
    delimiter: delimiter === "detect" ? null : delimiter === "tab" ? "\t" : delimiter,
    encoding: text("encoding").trim().toLowerCase() || "utf-8",
    decimalSeparator: text("decimalSeparator"),
    dateFormat: text("dateFormat"),
    columns: Object.fromEntries(
      fieldNames
        .map((field) => [field, text(`column.${field}`)] as const)
        .filter(([, header]) => header !== ""),
    ),
    debitValues: debitValues.length > 0 ? debitValues : null,
  });
  return parsed.success ? parsed.data : null;
}

// The form's values for a profile, to edit it.
export function profileFormValues(profile: ImportProfile): ProfileFormValues {
  return {
    name: profile.name,
    skipLines: String(profile.skipLines),
    delimiter:
      profile.delimiter === null
        ? "detect"
        : profile.delimiter === "\t"
          ? "tab"
          : profile.delimiter,
    encoding: profile.encoding,
    decimalSeparator: profile.decimalSeparator,
    dateFormat: profile.dateFormat,
    debitValues: profile.debitValues?.join(", ") ?? "",
    ...Object.fromEntries(
      fieldNames.map((field) => [`column.${field}`, profile.columns[field] ?? ""]),
    ),
  };
}

// What a submitted mapping form held, to show it again after a refusal or a re-read.
export function formValues(formData: FormData): ProfileFormValues {
  return Object.fromEntries(
    [...formNames].map((name) => {
      const value = formData.get(name);
      return [name, typeof value === "string" ? value.slice(0, 200) : ""];
    }),
  );
}
