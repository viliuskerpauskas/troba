"use server";

import {
  assertNever,
  commitImport,
  createAccount,
  getImportProfile,
  isCsvUpload,
  listAccounts,
  matchImportProfile,
  maxImportFileBytes,
  previewImport,
  readCsv,
  saveImportProfile,
  type Account,
  type Delimiter,
  type ImportProfile,
  type ImportRefusal,
  type ImportRowFailure,
  type PreviewImportResult,
  type SavedImportProfile,
} from "@troba/core";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { requireMoneyUser } from "@/server/money";
import {
  formValues,
  profileFormValues,
  profileFromForm,
  type ProfileFormValues,
} from "./profile-form";

// The import wizard (SPEC-money M3): upload → mapping (unknown formats) → preview → confirm. The
// client keeps the file and sends it with every step, since commit reads it again rather than
// trusting a preview (see commitImport). Each step's state is everything the next form needs.
//
// Descriptions and raw rows can hold masked card numbers: never log them.

export type MappingTable = {
  headers: string[];
  // The first rows, for the user to see which column is which.
  sampleRows: string[][];
  skipLines: number;
  delimiter: Delimiter;
};

export type ImportState =
  | { step: "upload"; error?: string }
  | {
      step: "mapping";
      // Null when the file can't be read with the form's settings; the error says why.
      table: MappingTable | null;
      values: ProfileFormValues;
      // The profile being edited; null for a new one.
      profileId: string | null;
      error?: string;
    }
  | {
      step: "preview";
      profile: { id: string; name: string };
      accountId: string | null;
      preview: PreviewView;
      error?: string;
    }
  | {
      step: "done";
      accountName: string;
      rowsNew: number;
      rowsDuplicate: number;
      rowsFailed: number;
    };

export type PreviewView =
  | {
      ok: true;
      account: { id: string; name: string };
      rowsParsed: number;
      rowsNew: number;
      rowsDuplicate: number;
      failed: ImportRowFailure[];
      debitCredit: { value: string; debit: boolean; rows: number }[] | null;
    }
  // The file names an account the user doesn't have: offered to create it.
  | { ok: false; reason: "unknown-account"; iban: string; currency: string }
  // The file names no account: the user picks one.
  | { ok: false; reason: "account-required"; accounts: { id: string; name: string }[] }
  | { ok: false; reason: "refused"; message: string };

const Id = z.uuid();
const OptionalId = z.union([z.uuid(), z.literal("")]).transform((id) => id || null);
const AccountName = z.string().trim().min(1).max(100);

const tooLarge = `That file is over ${maxImportFileBytes / 1024 / 1024} MB. Export a shorter period.`;
const notCsv = "That isn't a CSV file. Export your statement from your bank as CSV.";
const startAgain = "Something changed since the last step. Upload the file again.";

type Upload = { filename: string; bytes: Uint8Array };

// The file every step sends. Checked before anything reads it: the declared size, then the
// content.
async function readUpload(formData: FormData): Promise<Upload | { error: string }> {
  const file = z.file().safeParse(formData.get("file"));
  if (!file.success || file.data.size === 0) return { error: "Choose a CSV file to import." };
  if (file.data.size > maxImportFileBytes) return { error: tooLarge };
  const bytes = new Uint8Array(await file.data.arrayBuffer());
  if (!isCsvUpload({ type: file.data.type, bytes })) return { error: notCsv };
  return { filename: file.data.name.slice(0, 200), bytes };
}

export async function startImportAction(formData: FormData): Promise<ImportState> {
  const { userId } = await requireMoneyUser();
  const upload = await readUpload(formData);
  if ("error" in upload) return { step: "upload", error: upload.error };
  const profileId = OptionalId.safeParse(formData.get("profileId") ?? "");
  if (!profileId.success) return { step: "upload", error: startAgain };

  const profile = profileId.data
    ? await getImportProfile(db(), userId, profileId.data)
    : await matchImportProfile(db(), userId, upload.bytes);
  if (profileId.data && !profile) return { step: "upload", error: startAgain };
  if (profile) return previewState(userId, profile, upload, null);

  // An unknown format: the mapping step, starting from what the file itself shows.
  const values = {
    ...formValues(new FormData()),
    name: upload.filename.replace(/\.csv$/i, "").slice(0, 100),
    delimiter: "detect",
    encoding: "utf-8",
    decimalSeparator: ".",
    dateFormat: "YYYY-MM-DD",
  };
  return mappingState(upload, values, null, { encoding: "utf-8" });
}

// The mapping step again, read with the skip lines, delimiter and encoding the user corrected.
export async function rereadMappingAction(formData: FormData): Promise<ImportState> {
  await requireMoneyUser();
  const upload = await readUpload(formData);
  if ("error" in upload) return { step: "upload", error: upload.error };
  const profileId = OptionalId.safeParse(formData.get("editing") ?? "");
  const values = formValues(formData);
  const skipLines = values.skipLines?.trim();
  return mappingState(upload, values, profileId.success ? profileId.data : null, {
    ...readSettings(values),
    // Blank or not a count: guessed again.
    skipLines: /^\d{1,2}$/.test(skipLines ?? "") ? Number(skipLines) : undefined,
  });
}

export async function editProfileAction(formData: FormData): Promise<ImportState> {
  const { userId } = await requireMoneyUser();
  const upload = await readUpload(formData);
  if ("error" in upload) return { step: "upload", error: upload.error };
  const profileId = Id.safeParse(formData.get("profileId"));
  const profile = profileId.success ? await getImportProfile(db(), userId, profileId.data) : null;
  if (!profile) return { step: "upload", error: startAgain };
  return mappingState(upload, profileFormValues(profile), profile.id, profile);
}

const saveErrors = {
  "file-too-large": tooLarge,
  "not-found": startAgain,
  "unknown-encoding": "That encoding isn't one troba knows. Try utf-8 or windows-1252.",
  "invalid-encoding": "The file doesn't read as that encoding. Try another, such as windows-1252.",
  "unterminated-quote":
    "The file has a quote that never closes. Check the skip lines and delimiter.",
} as const;

export async function saveProfileAction(formData: FormData): Promise<ImportState> {
  const { userId } = await requireMoneyUser();
  const upload = await readUpload(formData);
  if ("error" in upload) return { step: "upload", error: upload.error };
  const editing = OptionalId.safeParse(formData.get("editing") ?? "");
  const values = formValues(formData);
  const profileId = editing.success ? editing.data : null;
  const profile = profileFromForm(formData);
  if (!profile) {
    const mapping = mappingState(upload, values, profileId, readSettings(values));
    return { ...mapping, error: mappingError(values) };
  }

  const saved = await saveImportProfile(db(), userId, {
    profileId,
    profile,
    bytes: upload.bytes,
  });
  if (!saved.ok) {
    const mapping = mappingState(upload, values, profileId, profile);
    const error =
      saved.reason === "missing-columns"
        ? `The file has no column named ${saved.columns.join(", ")}. Check the skip lines.`
        : saveErrors[saved.reason];
    return { ...mapping, error };
  }
  return previewState(userId, saved.profile, upload, null);
}

export async function previewImportAction(formData: FormData): Promise<ImportState> {
  const { userId } = await requireMoneyUser();
  const step = await previewStep(userId, formData);
  if ("error" in step) return { step: "upload", error: step.error };
  return previewState(userId, step.profile, step.upload, step.accountId);
}

// The file named an account the user doesn't have: create it with the file's IBAN and currency,
// read on the server again, never taken from the form.
export async function createImportAccountAction(formData: FormData): Promise<ImportState> {
  const { userId } = await requireMoneyUser();
  const step = await previewStep(userId, formData);
  if ("error" in step) return { step: "upload", error: step.error };
  const preview = await previewImport(db(), userId, {
    profile: step.profile,
    profileId: step.profile.id,
    filename: step.upload.filename,
    bytes: step.upload.bytes,
  });
  if (preview.ok || preview.reason !== "unknown-account") {
    return previewState(userId, step.profile, step.upload, null);
  }
  const name = AccountName.safeParse(formData.get("accountName"));
  if (!name.success) {
    const state = await previewState(userId, step.profile, step.upload, null);
    return { ...state, error: "Enter a name for the account, up to 100 characters." };
  }

  const created = await createAccount(db(), userId, {
    name: name.data,
    type: "bank",
    currency: preview.currency,
    iban: preview.iban,
  });
  // iban-taken: another request created it first, and the preview now finds it.
  if (!created.ok && created.reason !== "iban-taken") {
    const state = await previewState(userId, step.profile, step.upload, null);
    return { ...state, error: "That account couldn't be created. Create it on the Accounts page." };
  }
  revalidatePath("/money/accounts");
  return previewState(userId, step.profile, step.upload, null);
}

export async function commitImportAction(formData: FormData): Promise<ImportState> {
  const { userId } = await requireMoneyUser();
  const step = await previewStep(userId, formData);
  if ("error" in step) return { step: "upload", error: step.error };
  const result = await commitImport(db(), userId, {
    profile: step.profile,
    profileId: step.profile.id,
    accountId: step.accountId,
    filename: step.upload.filename,
    bytes: step.upload.bytes,
  });
  // The file was refused after the preview accepted it: show the preview again, which says why.
  if (!result.ok) return previewState(userId, step.profile, step.upload, step.accountId);

  revalidatePath("/money", "layout");
  return {
    step: "done",
    accountName: result.account.name,
    rowsNew: result.rowsNew,
    rowsDuplicate: result.rowsDuplicate,
    rowsFailed: result.failed.length,
  };
}

// What preview, account creation and commit share: the file, its saved profile and the account
// picked, if any.
async function previewStep(
  userId: string,
  formData: FormData,
): Promise<
  { upload: Upload; profile: SavedImportProfile; accountId: string | null } | { error: string }
> {
  const upload = await readUpload(formData);
  if ("error" in upload) return upload;
  const profileId = Id.safeParse(formData.get("profileId"));
  const accountId = OptionalId.safeParse(formData.get("accountId") ?? "");
  if (!profileId.success || !accountId.success) return { error: startAgain };
  const profile = await getImportProfile(db(), userId, profileId.data);
  if (!profile) return { error: startAgain };
  return { upload, profile, accountId: accountId.data };
}

async function previewState(
  userId: string,
  profile: SavedImportProfile,
  upload: Upload,
  accountId: string | null,
): Promise<Extract<ImportState, { step: "preview" }>> {
  const result = await previewImport(db(), userId, {
    profile,
    profileId: profile.id,
    accountId,
    filename: upload.filename,
    bytes: upload.bytes,
  });
  return {
    step: "preview",
    profile: { id: profile.id, name: profile.name },
    accountId,
    preview: await previewView(userId, result),
  };
}

async function previewView(userId: string, result: PreviewImportResult): Promise<PreviewView> {
  if (result.ok) {
    const { account, rowsParsed, rowsNew, rowsDuplicate, failed, debitCredit } = result;
    return {
      ok: true,
      account: { id: account.id, name: account.name },
      rowsParsed,
      rowsNew,
      rowsDuplicate,
      failed,
      debitCredit,
    };
  }
  switch (result.reason) {
    case "unknown-account":
      return result;
    case "account-required":
    case "account-not-found": {
      const accounts = await listAccounts(db(), userId);
      return { ok: false, reason: "account-required", accounts: accounts.map(accountOption) };
    }
    default:
      return { ok: false, reason: "refused", message: refusalMessage(result) };
  }
}

function accountOption(account: Account) {
  return { id: account.id, name: `${account.name} (${account.currency})` };
}

function refusalMessage(
  refusal: Exclude<
    ImportRefusal,
    { reason: "unknown-account" | "account-required" | "account-not-found" }
  >,
): string {
  switch (refusal.reason) {
    case "file-too-large":
      return tooLarge;
    case "profile-not-found":
      return startAgain;
    case "unknown-encoding":
    case "invalid-encoding":
    case "unterminated-quote":
      return `${saveErrors[refusal.reason]} Edit the profile to fix it.`;
    case "missing-columns":
      return `This file has no column named ${refusal.columns.join(", ")}, which the profile needs. Edit the profile, or pick another.`;
    case "multiple-own-ibans":
      return "This file holds more than one of your accounts. Export one account per file.";
    case "account-mismatch":
      return "The file belongs to a different account than the one picked.";
    default:
      return assertNever(refusal);
  }
}

// Which part of the mapping form is wrong, in the order the user fills it.
function mappingError(values: ProfileFormValues): string {
  if (!values.name?.trim()) return "Name the profile, such as the bank's name.";
  if (!/^\d{1,3}$/.test(values.skipLines?.trim() ?? "")) {
    return "Enter how many lines to skip above the header, 0 or more.";
  }
  if (!values["column.bookingDate"] || !values["column.amount"]) {
    return "Map the booking date and the amount: every profile needs both.";
  }
  if (Boolean(values["column.debitCredit"]) !== Boolean(values.debitValues?.trim())) {
    return "A debit/credit column needs its debit values, such as D, and debit values need the column.";
  }
  if (Boolean(values["column.originalAmount"]) !== Boolean(values["column.originalCurrency"])) {
    return "Map the original amount and the original currency together, or neither.";
  }
  return "Check the profile: the encoding, date format or a column isn't valid.";
}

// How to read the file while the form isn't a valid profile yet.
function readSettings(values: ProfileFormValues) {
  const { delimiter } = values;
  return {
    delimiter:
      delimiter === ";" || delimiter === "," ? delimiter : delimiter === "tab" ? "\t" : null,
    encoding: values.encoding?.trim().toLowerCase() || "utf-8",
  } satisfies Partial<ImportProfile>;
}

const sampleRowCount = 5;

function mappingState(
  upload: Upload,
  values: ProfileFormValues,
  profileId: string | null,
  settings: Partial<Pick<ImportProfile, "skipLines" | "delimiter" | "encoding">>,
): Extract<ImportState, { step: "mapping" }> {
  const table = readCsv(upload.bytes, settings);
  if (!table.ok) {
    return { step: "mapping", table: null, values, profileId, error: saveErrors[table.reason] };
  }
  return {
    step: "mapping",
    table: {
      headers: table.headers,
      sampleRows: table.rows.slice(0, sampleRowCount),
      skipLines: table.skipLines,
      delimiter: table.delimiter,
    },
    // The skip lines the file was read with: guessed on the first read.
    values: { ...values, skipLines: String(table.skipLines) },
    profileId,
  };
}
