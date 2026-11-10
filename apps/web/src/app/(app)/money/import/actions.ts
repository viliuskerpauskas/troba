"use server";

import {
  assertNever,
  commitImport,
  createImportAccount,
  getImportProfile,
  checkStatementFile,
  listAccounts,
  maxImportFileBytes,
  presetBrand,
  previewImport,
  proposeMappingWithinLimit,
  readCsv,
  resolveImportFormat,
  saveImportProfile,
  suggestAfterImport,
  type Account,
  type AfterImportSuggestions,
  type Delimiter,
  type ImportInput,
  type ImportRefusal,
  type ImportRowFailure,
  type PresetBrand,
  type PreviewImportResult,
  type ReadCsvOptions,
  type SavedImportProfile,
} from "@troba/core";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { aiCategorizeDailyLimit, aiMappingDailyLimit } from "@/server/env";
import { requireMoneyUser } from "@/server/money";
import { categorizationModelClient } from "@/server/openai-categorization";
import { mappingModelClient } from "@/server/openai-mapping";
import {
  formatSources,
  notAStatementFileMessage,
  problemMessages,
  readErrors,
  startAgainMessage,
  suggestions,
  tooLargeMessage,
  unsupportedKindMessages,
  type FormatSource,
  type Suggestion,
} from "./messages";
import {
  echoFormValues,
  profileFormValues,
  profileFromForm,
  readOptionsFromForm,
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
      // Set for a file no profile fits: how the form came to be filled or blank (see Suggestion).
      // Absent when the user is editing a profile.
      suggestion?: Suggestion;
      error?: string;
    }
  | {
      step: "preview";
      // brand: the colors of the bank preset the profile was copied from, for its badge.
      profile: { id: string; name: string; brand: PresetBrand | null };
      // How the profile was found from the file's columns (see FormatSource).
      found?: FormatSource;
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
      // How the AI category suggestions for the new rows went (see afterImportNote). They are asked
      // for after the import is saved, so they never decide whether it happened.
      suggestions: AfterImportSuggestions;
    };

export type PreviewView =
  | {
      ok: true;
      account: { id: string; name: string };
      rowsParsed: number;
      rowsNew: number;
      rowsDuplicate: number;
      rowsFailed: number;
      // The first of the failed rows: a profile that doesn't fit fails every row, and the first
      // ones say why.
      failed: ImportRowFailure[];
      debitCredit: { value: string; debit: boolean; rows: number }[] | null;
    }
  // The file names an account the user doesn't have: offered to create it.
  | { ok: false; reason: "unknown-account"; iban: string; currency: string }
  // The file names no account: the user picks one.
  | { ok: false; reason: "account-required"; accounts: { id: string; name: string }[] }
  | { ok: false; reason: "refused"; message: string };

const shownFailures = 50;

const Id = z.uuid();
const OptionalId = z.union([z.uuid(), z.literal("")]).transform((id) => id || null);
const AccountName = z.string().trim().min(1).max(100);
// The mapping form sends its note along, so that it stays while the user works on the form.
const SuggestionField = z.enum(suggestions).optional().catch(undefined);
// The preview sends how its profile was found, for the same reason.
const FoundField = z.enum(formatSources).optional().catch(undefined);

const tooLarge = tooLargeMessage(maxImportFileBytes);

type Upload = { filename: string; bytes: Uint8Array };

// The file every step sends. Checked before anything reads it: the declared size, then the
// kind of statement file from its declared type and content. Only a CSV imports so far.
async function readUpload(formData: FormData): Promise<Upload | { error: string }> {
  const file = z.file().safeParse(formData.get("file"));
  if (!file.success || file.data.size === 0) return { error: "Choose a CSV file to import." };
  if (file.data.size > maxImportFileBytes) return { error: tooLarge };
  const bytes = new Uint8Array(await file.data.arrayBuffer());
  const checked = checkStatementFile({ type: file.data.type, bytes });
  if (!checked.ok) {
    return { error: checked.reason === "file-too-large" ? tooLarge : notAStatementFileMessage };
  }
  if (checked.kind !== "csv") return { error: unsupportedKindMessages[checked.kind] };
  return { filename: file.data.name.slice(0, 200), bytes };
}

export async function startImportAction(formData: FormData): Promise<ImportState> {
  const { userId } = await requireMoneyUser();
  const upload = await readUpload(formData);
  if ("error" in upload) return { step: "upload", error: upload.error };

  // The file's columns decide: the user's own profile, else a preset (now copied into theirs).
  const resolved = await resolveImportFormat(db(), userId, upload.bytes);
  if (resolved.kind === "profile")
    return previewState(userId, resolved.profile, upload, null, resolved.source);

  // An unknown format: the mapping step, filled in by the AI when it can, else starting from what
  // the file itself shows. A preset's file is not unknown (only the profile limit kept its copy
  // from being saved): nothing about it is sent anywhere.
  const plain = {
    ...echoFormValues(new FormData()),
    name: startingName(upload),
    delimiter: "detect",
    encoding: "utf-8",
    decimalSeparator: ".",
    dateFormat: "YYYY-MM-DD",
  };
  const plainState = (suggestion: Suggestion) =>
    mappingState(upload, plain, null, { encoding: "utf-8" }, suggestion);
  if (resolved.reason === "profile-limit") return plainState("profile-limit");

  const client = mappingModelClient();
  if (!client) return plainState("off");
  const result = await proposeMappingWithinLimit(db(), userId, upload.bytes, {
    client,
    dailyLimit: aiMappingDailyLimit(),
    read: { encoding: "utf-8" },
  });
  switch (result.status) {
    case "proposed": {
      // Only the form is filled: nothing is saved until the user presses save.
      const values = profileFormValues({ ...result.proposal.profile, name: startingName(upload) });
      return mappingState(upload, values, null, result.proposal.profile, "ai");
    }
    case "unavailable":
    case "capped":
      return plainState(result.status);
    // With a client configured, nothing was sent because the file had no rows to sample.
    case "not-asked":
      return plainState("no-rows");
    default:
      return assertNever(result);
  }
}

// The name a new profile starts with, for the user to change.
function startingName(upload: Upload): string {
  return upload.filename.replace(/\.csv$/i, "").slice(0, 100);
}

// The mapping step again, read with the skip lines, delimiter and encoding the user corrected.
export async function rereadMappingAction(formData: FormData): Promise<ImportState> {
  await requireMoneyUser();
  const upload = await readUpload(formData);
  if ("error" in upload) return { step: "upload", error: upload.error };
  const editing = OptionalId.safeParse(formData.get("editing") ?? "");
  return mappingState(
    upload,
    echoFormValues(formData),
    editing.success ? editing.data : null,
    readOptionsFromForm(formData),
    SuggestionField.parse(formData.get("suggestion") ?? undefined),
  );
}

export async function editProfileAction(formData: FormData): Promise<ImportState> {
  const { userId } = await requireMoneyUser();
  const upload = await readUpload(formData);
  if ("error" in upload) return { step: "upload", error: upload.error };
  const profileId = Id.safeParse(formData.get("profileId"));
  const profile = profileId.success ? await getImportProfile(db(), userId, profileId.data) : null;
  if (!profile) return { step: "upload", error: startAgainMessage };
  return mappingState(upload, profileFormValues(profile), profile.id, profile);
}

const saveErrors = {
  ...readErrors,
  "file-too-large": tooLarge,
  "not-found": startAgainMessage,
  "too-many-profiles": "You have too many import profiles. Edit one of them instead.",
} as const;

export async function saveProfileAction(formData: FormData): Promise<ImportState> {
  const { userId } = await requireMoneyUser();
  const upload = await readUpload(formData);
  if ("error" in upload) return { step: "upload", error: upload.error };
  const editing = OptionalId.safeParse(formData.get("editing") ?? "");
  const profileId = editing.success ? editing.data : null;
  const values = echoFormValues(formData);
  const suggestion = SuggestionField.parse(formData.get("suggestion") ?? undefined);
  const read = profileFromForm(formData);
  if (!read.ok) {
    // Read as the user last set it, so their corrections and column choices stay.
    const mapping = mappingState(
      upload,
      values,
      profileId,
      readOptionsFromForm(formData),
      suggestion,
    );
    return { ...mapping, error: problemMessages[read.problem] };
  }

  const saved = await saveImportProfile(db(), userId, {
    profileId,
    profile: read.profile,
    bytes: upload.bytes,
  });
  if (!saved.ok) {
    const mapping = mappingState(upload, values, profileId, read.profile, suggestion);
    const error =
      saved.reason === "missing-columns"
        ? `The file has no column named ${saved.columns.join(", ")}. Check the lines above the header.`
        : saveErrors[saved.reason];
    return { ...mapping, error };
  }
  return previewState(userId, saved.profile, upload, null);
}

export async function previewImportAction(formData: FormData): Promise<ImportState> {
  const { userId } = await requireMoneyUser();
  const input = await readPreviewInput(userId, formData);
  if ("error" in input) return { step: "upload", error: input.error };
  return previewState(userId, input.profile, input.upload, input.accountId, input.found);
}

// The preview offered a bank account for the file's own IBAN.
export async function createImportAccountAction(formData: FormData): Promise<ImportState> {
  const { userId } = await requireMoneyUser();
  const input = await readPreviewInput(userId, formData);
  if ("error" in input) return { step: "upload", error: input.error };
  const name = AccountName.safeParse(formData.get("accountName"));
  if (!name.success) {
    const state = await previewState(userId, input.profile, input.upload, null, input.found);
    return { ...state, error: "Enter a name for the account, up to 100 characters." };
  }

  const created = await createImportAccount(db(), userId, {
    profile: input.profile,
    bytes: input.upload.bytes,
    name: name.data,
  });
  if (created.ok) revalidatePath("/money/accounts");
  // Refused or not: the preview shows where the file stands now.
  return previewState(userId, input.profile, input.upload, null, input.found);
}

export async function commitImportAction(formData: FormData): Promise<ImportState> {
  const { userId } = await requireMoneyUser();
  const input = await readPreviewInput(userId, formData);
  if ("error" in input) return { step: "upload", error: input.error };
  const result = await commitImport(db(), userId, importInput(input));
  // The file was refused after the preview accepted it: show the preview again, which says why.
  if (!result.ok)
    return previewState(userId, input.profile, input.upload, input.accountId, input.found);

  // The import is committed, and nothing from here can undo or fail it. The model is asked for at
  // most a bounded wait (see suggestAfterImport): a slower run finishes on its own and its
  // suggestions turn up on the transactions list. A file with no new rows has nothing to ask about.
  const suggestions: AfterImportSuggestions =
    result.rowsNew > 0
      ? await suggestAfterImport(db(), userId, {
          client: categorizationModelClient(),
          importId: result.importId,
          dailyLimit: aiCategorizeDailyLimit(),
        })
      : { status: "nothing" };

  revalidatePath("/money", "layout");
  return {
    step: "done",
    accountName: result.account.name,
    rowsNew: result.rowsNew,
    rowsDuplicate: result.rowsDuplicate,
    rowsFailed: result.failed.length,
    suggestions,
  };
}

type PreviewInput = {
  upload: Upload;
  profile: SavedImportProfile;
  accountId: string | null;
  found?: FormatSource;
};

// What preview, account creation and commit are sent: the file, its saved profile, the account
// picked, if any, and how the profile was found.
async function readPreviewInput(
  userId: string,
  formData: FormData,
): Promise<PreviewInput | { error: string }> {
  const upload = await readUpload(formData);
  if ("error" in upload) return upload;
  const profileId = Id.safeParse(formData.get("profileId"));
  const accountId = OptionalId.safeParse(formData.get("accountId") ?? "");
  if (!profileId.success || !accountId.success) return { error: startAgainMessage };
  const profile = await getImportProfile(db(), userId, profileId.data);
  if (!profile) return { error: startAgainMessage };
  const found = FoundField.parse(formData.get("found") ?? undefined);
  return { upload, profile, accountId: accountId.data, ...(found && { found }) };
}

function importInput({ upload, profile, accountId }: PreviewInput): ImportInput {
  return { profile, profileId: profile.id, accountId, ...upload };
}

async function previewState(
  userId: string,
  profile: SavedImportProfile,
  upload: Upload,
  accountId: string | null,
  found?: FormatSource,
): Promise<Extract<ImportState, { step: "preview" }>> {
  const result = await previewImport(db(), userId, importInput({ upload, profile, accountId }));
  return {
    step: "preview",
    profile: { id: profile.id, name: profile.name, brand: presetBrand(profile) },
    ...(found && { found }),
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
      rowsFailed: failed.length,
      failed: failed.slice(0, shownFailures),
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
      return startAgainMessage;
    case "unknown-encoding":
    case "invalid-encoding":
    case "unterminated-quote":
      return `${readErrors[refusal.reason]} Edit the profile to fix it.`;
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

const sampleRowCount = 5;

function mappingState(
  upload: Upload,
  values: ProfileFormValues,
  profileId: string | null,
  options: ReadCsvOptions,
  suggestion?: Suggestion,
): Extract<ImportState, { step: "mapping" }> {
  const table = readCsv(upload.bytes, options);
  if (!table.ok) {
    return {
      step: "mapping",
      table: null,
      values,
      profileId,
      ...(suggestion && { suggestion }),
      error: readErrors[table.reason],
    };
  }
  return {
    step: "mapping",
    table: {
      headers: table.headers,
      sampleRows: table.rows.slice(0, sampleRowCount),
      skipLines: table.skipLines,
      delimiter: table.delimiter,
    },
    // The skip lines the file was read with: guessed when the form gave none.
    values: { ...values, skipLines: String(table.skipLines) },
    profileId,
    ...(suggestion && { suggestion }),
  };
}
