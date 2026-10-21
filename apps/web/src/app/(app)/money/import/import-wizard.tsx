"use client";

import type { DateFormat, ImportField } from "@troba/core";
import Link from "next/link";
import { startTransition, useActionState, useState, type FormEvent } from "react";
import {
  commitImportAction,
  createImportAccountAction,
  editProfileAction,
  previewImportAction,
  rereadMappingAction,
  saveProfileAction,
  startImportAction,
  type ImportState,
  type MappingTable,
  type PreviewView,
} from "./actions";
import { importFields, requiredFields } from "./fields";

type ProfileOption = { id: string; name: string };

// Each submit button names the step it runs.
const actions = {
  start: startImportAction,
  reread: rereadMappingAction,
  save: saveProfileAction,
  edit: editProfileAction,
  preview: previewImportAction,
  "create-account": createImportAccountAction,
  commit: commitImportAction,
} satisfies Record<string, (formData: FormData) => Promise<ImportState>>;

async function run(state: ImportState, formData: FormData): Promise<ImportState> {
  const intent = String(formData.get("intent"));
  if (intent === "restart") return { step: "upload" };
  return intent in actions ? actions[intent as keyof typeof actions](formData) : state;
}

export function ImportWizard({
  profiles,
  dateFormats,
  maxBytes,
}: {
  profiles: ProfileOption[];
  dateFormats: readonly DateFormat[];
  maxBytes: number;
}) {
  const [state, dispatch, pending] = useActionState(run, { step: "upload" });
  // The file the user chose, sent again with every step: the server keeps nothing between them.
  const [file, setFile] = useState<File | null>(null);
  const [tooLarge, setTooLarge] = useState(false);

  // Submitted by hand, so React doesn't reset the forms (and the file input) after each step.
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget, (event.nativeEvent as SubmitEvent).submitter);
    if (file) data.set("file", file);
    if (data.get("intent") === "start" && file && file.size > maxBytes) {
      setTooLarge(true);
      return;
    }
    startTransition(() => dispatch(data));
  }

  switch (state.step) {
    case "upload":
      return (
        <form onSubmit={submit}>
          <p>
            <label htmlFor="import-file">CSV file from your bank</label>
            <br />
            <input
              id="import-file"
              type="file"
              name="file"
              accept=".csv,text/csv"
              required
              onChange={(event) => {
                setFile(event.currentTarget.files?.[0] ?? null);
                setTooLarge(false);
              }}
            />
          </p>
          <p>
            <label htmlFor="import-profile">Import profile</label>
            <br />
            <select id="import-profile" name="profileId" defaultValue="">
              <option value="">Find by the file&apos;s columns</option>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
          </p>
          {tooLarge && (
            <p role="alert">
              That file is over {maxBytes / 1024 / 1024} MB. Export a shorter period.
            </p>
          )}
          {state.error && <p role="alert">{state.error}</p>}
          <button type="submit" name="intent" value="start" disabled={pending}>
            Continue
          </button>
        </form>
      );
    case "mapping":
      return (
        <MappingForm
          // Read again with other settings: the column choices start from the echoed values.
          key={JSON.stringify([state.values, state.table?.headers])}
          state={state}
          dateFormats={dateFormats}
          pending={pending}
          onSubmit={submit}
        />
      );
    case "preview":
      return <PreviewForm state={state} pending={pending} onSubmit={submit} />;
    case "done":
      return (
        <form onSubmit={submit}>
          <p role="status">
            Imported {count(state.rowsNew, "transaction")} into {state.accountName}.
            {state.rowsDuplicate > 0 &&
              ` Skipped ${count(state.rowsDuplicate, "row")} already imported.`}
            {state.rowsFailed > 0 && ` ${count(state.rowsFailed, "row")} couldn't be read.`}
          </p>
          <p>
            <Link href="/money/transactions">View transactions</Link>
          </p>
          <button type="submit" name="intent" value="restart" onClick={() => setFile(null)}>
            Import another file
          </button>
        </form>
      );
  }
}

type StepProps<S extends ImportState["step"]> = {
  state: Extract<ImportState, { step: S }>;
  pending: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

function MappingForm({
  state,
  dateFormats,
  pending,
  onSubmit,
}: StepProps<"mapping"> & { dateFormats: readonly DateFormat[] }) {
  const { table, values } = state;
  const value = (name: string) => values[name] ?? "";

  return (
    <form onSubmit={onSubmit}>
      <input type="hidden" name="editing" value={state.profileId ?? ""} />
      <h2>{state.profileId ? "Edit the import profile" : "Map the columns"}</h2>
      {!state.profileId && (
        <p>
          troba hasn&apos;t seen this format yet. Say which column holds what, once: it&apos;s saved
          as a profile, and later files with the same columns use it.
        </p>
      )}
      <p>
        <label htmlFor="profile-name">Profile name</label>
        <br />
        <input
          id="profile-name"
          name="name"
          defaultValue={value("name")}
          maxLength={100}
          required
        />
      </p>
      <fieldset>
        <legend>Reading the file</legend>
        <p>
          <label htmlFor="profile-skip-lines">Lines above the header</label>
          <br />
          <input
            id="profile-skip-lines"
            name="skipLines"
            type="number"
            min={0}
            max={99}
            defaultValue={value("skipLines")}
            aria-describedby="profile-skip-lines-hint"
          />
          <br />
          <small id="profile-skip-lines-hint">
            Banks may put a title above the column names. Change it if the headers below look wrong,
            then read the file again.
          </small>
        </p>
        <p>
          <label htmlFor="profile-delimiter">Delimiter</label>
          <br />
          <select id="profile-delimiter" name="delimiter" defaultValue={value("delimiter")}>
            <option value="detect">Detect</option>
            <option value=";">Semicolon ;</option>
            <option value=",">Comma ,</option>
            <option value="tab">Tab</option>
          </select>
        </p>
        <p>
          <label htmlFor="profile-encoding">Encoding</label>
          <br />
          <input
            id="profile-encoding"
            name="encoding"
            defaultValue={value("encoding")}
            maxLength={40}
            spellCheck={false}
            aria-describedby="profile-encoding-hint"
          />
          <br />
          <small id="profile-encoding-hint">
            utf-8 for most banks; older ones may use a code page such as windows-1252.
          </small>
        </p>
        <button type="submit" name="intent" value="reread" disabled={pending}>
          Read the file again
        </button>
      </fieldset>
      {table && <FilePreview table={table} />}
      <fieldset>
        <legend>Numbers and dates</legend>
        <p>
          <label htmlFor="profile-decimal">Decimal separator</label>
          <br />
          <select
            id="profile-decimal"
            name="decimalSeparator"
            defaultValue={value("decimalSeparator")}
          >
            <option value=".">Point: 1,234.56</option>
            <option value=",">Comma: 1.234,56</option>
          </select>
        </p>
        <p>
          <label htmlFor="profile-date-format">Date format</label>
          <br />
          <select id="profile-date-format" name="dateFormat" defaultValue={value("dateFormat")}>
            {dateFormats.map((format) => (
              <option key={format} value={format}>
                {format}
              </option>
            ))}
          </select>
        </p>
      </fieldset>
      <fieldset>
        <legend>Columns</legend>
        {(Object.keys(importFields) as ImportField[]).map((field) => (
          <ColumnSelect
            key={field}
            field={field}
            headers={table?.headers ?? []}
            defaultValue={value(`column.${field}`)}
          />
        ))}
        <p>
          <label htmlFor="profile-debit-values">Debit values</label>
          <br />
          <input
            id="profile-debit-values"
            name="debitValues"
            defaultValue={value("debitValues")}
            maxLength={200}
            aria-describedby="profile-debit-values-hint"
          />
          <br />
          <small id="profile-debit-values-hint">
            With a debit/credit column: the values that mean money went out, comma-separated, such
            as D.
          </small>
        </p>
      </fieldset>
      {state.error && <p role="alert">{state.error}</p>}
      <button type="submit" name="intent" value="save" disabled={pending || !table}>
        Save profile and preview
      </button>{" "}
      <button type="submit" name="intent" value="restart" formNoValidate>
        Start over
      </button>
    </form>
  );
}

function ColumnSelect({
  field,
  headers,
  defaultValue,
}: {
  field: ImportField;
  headers: string[];
  defaultValue: string;
}) {
  const { label, hint } = importFields[field];
  const id = `profile-column-${field}`;
  const required = requiredFields.has(field);
  return (
    <p>
      <label htmlFor={id}>{label}</label>
      <br />
      <select
        id={id}
        name={`column.${field}`}
        defaultValue={headers.includes(defaultValue) ? defaultValue : ""}
        required={required}
        aria-describedby={hint ? `${id}-hint` : undefined}
      >
        <option value="">{required ? "Pick a column" : "Not in this file"}</option>
        {headers.map((header, i) => (
          <option key={i} value={header}>
            {header}
          </option>
        ))}
      </select>
      {hint && (
        <>
          <br />
          <small id={`${id}-hint`}>{hint}</small>
        </>
      )}
    </p>
  );
}

function FilePreview({ table }: { table: MappingTable }) {
  return (
    // Scrolls on its own, so a wide statement doesn't widen the page on a phone.
    <div role="region" aria-labelledby="file-preview" tabIndex={0} style={{ overflowX: "auto" }}>
      <table>
        <caption id="file-preview">
          The file as read: {table.headers.length} columns, {delimiterNames[table.delimiter]}
        </caption>
        <thead>
          <tr>
            {table.headers.map((header, i) => (
              <th key={i} scope="col">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.sampleRows.map((row, i) => (
            <tr key={i}>
              {table.headers.map((_, j) => (
                <td key={j}>{row[j]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const delimiterNames: Record<MappingTable["delimiter"], string> = {
  ",": "comma-separated",
  ";": "semicolon-separated",
  "\t": "tab-separated",
};

function PreviewForm({ state, pending, onSubmit }: StepProps<"preview">) {
  const { preview } = state;
  return (
    <form onSubmit={onSubmit}>
      <input type="hidden" name="profileId" value={state.profile.id} />
      <h2>Preview</h2>
      <p>
        Read with the profile {state.profile.name}.{" "}
        <button type="submit" name="intent" value="edit" disabled={pending} formNoValidate>
          Edit profile
        </button>
      </p>
      <PreviewBody preview={preview} accountId={state.accountId} pending={pending} />
      {state.error && <p role="alert">{state.error}</p>}
      <p>
        <button type="submit" name="intent" value="restart" formNoValidate>
          Start over
        </button>
      </p>
    </form>
  );
}

const failureReasons: Record<
  Extract<PreviewView, { ok: true }>["failed"][number]["reason"],
  string
> = {
  "invalid-date": "the date isn't in the profile's date format",
  "invalid-amount": "the amount isn't a number with the profile's decimal separator",
  "invalid-debit-credit": "the debit/credit indicator is empty",
  "invalid-currency": "the currency isn't a three-letter code",
  "invalid-original-amount": "the original amount isn't a number",
  "invalid-own-iban": "the account IBAN isn't valid",
  "duplicate-transaction-id": "another row has the same transaction ID",
  "currency-mismatch": "the row's currency isn't the account's",
};

// A broken profile fails every row; the first ones say why.
const shownFailures = 50;

function PreviewBody({
  preview,
  accountId,
  pending,
}: {
  preview: PreviewView;
  accountId: string | null;
  pending: boolean;
}) {
  if (!preview.ok) {
    switch (preview.reason) {
      case "unknown-account":
        return (
          <>
            <p>
              This file is for the account with IBAN {preview.iban} ({preview.currency}), which you
              don&apos;t have in troba yet.
            </p>
            <p>
              <label htmlFor="import-account-name">Account name</label>
              <br />
              <input
                id="import-account-name"
                name="accountName"
                maxLength={100}
                defaultValue="Bank account"
                required
              />
            </p>
            <button type="submit" name="intent" value="create-account" disabled={pending}>
              Create the account and preview
            </button>
          </>
        );
      case "account-required":
        return (
          <>
            <p>This file doesn&apos;t say which account it&apos;s for.</p>
            <p>
              <label htmlFor="import-account">Account</label>
              <br />
              <select id="import-account" name="accountId" required defaultValue="">
                <option value="" disabled>
                  Pick an account
                </option>
                {preview.accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </p>
            <button type="submit" name="intent" value="preview" disabled={pending}>
              Preview
            </button>
          </>
        );
      case "refused":
        return <p role="alert">{preview.message}</p>;
    }
  }

  const { failed } = preview;
  return (
    <>
      <input type="hidden" name="accountId" value={accountId ?? ""} />
      <p>Account: {preview.account.name}</p>
      <dl aria-label="Import summary">
        <dt>Rows in the file</dt>
        <dd>{preview.rowsParsed}</dd>
        <dt>New</dt>
        <dd>{preview.rowsNew}</dd>
        <dt>Already imported, skipped</dt>
        <dd>{preview.rowsDuplicate}</dd>
        <dt>Can&apos;t be read</dt>
        <dd>{failed.length}</dd>
      </dl>
      {preview.debitCredit && (
        <>
          <p id="debit-credit">Debit/credit values in the file. Check they read the right way:</p>
          <ul aria-labelledby="debit-credit">
            {preview.debitCredit.map(({ value, debit, rows }) => (
              <li key={value}>
                {value}: {count(rows, "row")}, read as {debit ? "money out" : "money in"}
              </li>
            ))}
          </ul>
        </>
      )}
      {failed.length > 0 && (
        <>
          <p id="failed-rows">These rows can&apos;t be read and won&apos;t be imported:</p>
          <ul aria-labelledby="failed-rows">
            {failed.slice(0, shownFailures).map(({ row, reason }) => (
              <li key={row}>
                Row {row}: {failureReasons[reason]}
              </li>
            ))}
          </ul>
          {failed.length > shownFailures && <p>And {failed.length - shownFailures} more.</p>}
        </>
      )}
      {preview.rowsNew > 0 ? (
        <button type="submit" name="intent" value="commit" disabled={pending}>
          Import {count(preview.rowsNew, "transaction")}
        </button>
      ) : (
        <p role="status">Nothing new to import.</p>
      )}
    </>
  );
}

function count(n: number, noun: string) {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
