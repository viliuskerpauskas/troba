import {
  importProfileFields,
  importProfileSchema,
  type Delimiter,
  type ImportField,
  type ImportProfile,
  type ReadCsvOptions,
} from "@troba/core";
import { z } from "zod";
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

// The part of the form that is wrong, in the order the form shows them. The profile schema owns
// the rules; this only says where its first complaint is.
const problems = [
  "name",
  "skipLines",
  "encoding",
  "decimalSeparator",
  "dateFormat",
  "columns",
  "debitValues",
] as const;
export type ProfileFormProblem = (typeof problems)[number];

export type ProfileFromFormResult =
  { ok: true; profile: ImportProfile } | { ok: false; problem: ProfileFormProblem };

// A count typed into the form, within the profile's bounds; blank is not a count.
const SkipLines = z
  .string()
  .trim()
  .regex(/^\d+$/)
  .transform(Number)
  .pipe(importProfileFields.shape.skipLines.unwrap());

const Encoding = z.string().trim().toLowerCase().max(40);

export function profileFromForm(formData: FormData): ProfileFromFormResult {
  for (const name of formData.keys()) {
    if (name.startsWith("column.") && !formNames.has(name))
      return { ok: false, problem: "columns" };
  }
  const debitValues = text(formData, "debitValues")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const skipLines = SkipLines.safeParse(text(formData, "skipLines"));
  if (!skipLines.success) return { ok: false, problem: "skipLines" };

  const parsed = importProfileSchema.safeParse({
    name: text(formData, "name"),
    skipLines: skipLines.data,
    delimiter: delimiterFromForm(text(formData, "delimiter")),
    encoding: encodingFromForm(formData),
    decimalSeparator: text(formData, "decimalSeparator"),
    dateFormat: text(formData, "dateFormat"),
    columns: Object.fromEntries(
      fieldNames
        .map((field) => [field, text(formData, `column.${field}`)] as const)
        .filter(([, header]) => header !== ""),
    ),
    debitValues: debitValues.length > 0 ? debitValues : null,
  });
  if (parsed.success) return { ok: true, profile: parsed.data };
  const wrong = new Set(parsed.error.issues.map((issue) => issue.path[0]));
  return { ok: false, problem: problems.find((problem) => wrong.has(problem)) ?? "columns" };
}

// How to read the file for the mapping step, from a form that may not be a valid profile yet.
// Skip lines that aren't a count are left to be guessed; an encoding that isn't one is passed on
// for the read to refuse, so the user sees why.
export function readOptionsFromForm(formData: FormData): ReadCsvOptions {
  const skipLines = SkipLines.safeParse(text(formData, "skipLines"));
  return {
    skipLines: skipLines.success ? skipLines.data : undefined,
    delimiter: delimiterFromForm(text(formData, "delimiter")),
    encoding: encodingFromForm(formData),
  };
}

// The form's values for a profile, to edit it.
export function profileFormValues(profile: ImportProfile): ProfileFormValues {
  return {
    name: profile.name,
    skipLines: String(profile.skipLines),
    delimiter: delimiterToForm(profile.delimiter),
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
export function echoFormValues(formData: FormData): ProfileFormValues {
  return Object.fromEntries(
    [...formNames].map((name) => [name, text(formData, name).slice(0, 200)]),
  );
}

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

// Anything but a delimiter readCsv knows is "detect".
function delimiterFromForm(value: string): Delimiter | null {
  const delimiter = value === "tab" ? "\t" : value;
  const known = importProfileFields.shape.delimiter.safeParse(delimiter);
  return known.success ? known.data : null;
}

function delimiterToForm(delimiter: Delimiter | null): string {
  return delimiter === null ? "detect" : delimiter === "\t" ? "tab" : delimiter;
}

function encodingFromForm(formData: FormData): string {
  const encoding = Encoding.safeParse(text(formData, "encoding"));
  return (encoding.success && encoding.data) || "utf-8";
}
