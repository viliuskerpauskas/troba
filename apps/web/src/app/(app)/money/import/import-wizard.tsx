"use client";

import type { DateFormat, ImportField } from "@troba/core";
import Link from "next/link";
import {
  startTransition,
  useActionState,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { DescriptionList } from "@/components/description-list";
import { FormError, FormStatus } from "@/components/form-message";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { failureReasons, tooLargeMessage } from "./messages";

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

const firstStep: ImportState = { step: "upload" };

async function run(state: ImportState, formData: FormData): Promise<ImportState> {
  const intent = String(formData.get("intent"));
  if (intent === "restart") return { step: "upload" };
  return Object.hasOwn(actions, intent) ? actions[intent as keyof typeof actions](formData) : state;
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
  const [state, dispatch, pending] = useActionState(run, firstStep);
  // The file the user chose, sent again with every step: the server keeps nothing between them.
  const [file, setFile] = useState<File | null>(null);
  const [tooLarge, setTooLarge] = useState(false);
  const stepStart = useRef<HTMLDivElement>(null);

  // The button that ran a step is gone once the next one renders, which drops focus to the page:
  // put it at the start of the step instead, so a keyboard user carries on from there. Not on the
  // page load's first step (restarting gives a new state object), which would steal focus. A
  // refused submit moves it too: its disabled button lost focus while pending.
  useEffect(() => {
    if (state !== firstStep && document.activeElement === document.body) stepStart.current?.focus();
  }, [state]);

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

  return (
    <div ref={stepStart} tabIndex={-1} className="outline-none">
      {renderStep()}
    </div>
  );

  function renderStep() {
    switch (state.step) {
      case "upload":
        return (
          <form onSubmit={submit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="import-file">CSV file from your bank</FieldLabel>
                <Input
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
              </Field>
              <Field>
                <FieldLabel htmlFor="import-profile">Import profile</FieldLabel>
                <NativeSelect id="import-profile" name="profileId" defaultValue="">
                  <NativeSelectOption value="">Find by the file&apos;s columns</NativeSelectOption>
                  {profiles.map((profile) => (
                    <NativeSelectOption key={profile.id} value={profile.id}>
                      {profile.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
              {tooLarge && <FormError>{tooLargeMessage(maxBytes)}</FormError>}
              {state.error && <FormError>{state.error}</FormError>}
              <Button
                type="submit"
                name="intent"
                value="start"
                disabled={pending}
                className="self-start"
              >
                Continue
              </Button>
            </FieldGroup>
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
          <form onSubmit={submit} className="flex flex-col gap-4">
            <FormStatus>
              Imported {count(state.rowsNew, "transaction")} into {state.accountName}.
              {state.rowsDuplicate > 0 &&
                ` Skipped ${count(state.rowsDuplicate, "row")} already imported.`}
              {state.rowsFailed > 0 && ` ${count(state.rowsFailed, "row")} couldn't be read.`}
            </FormStatus>
            <p>
              <Link href="/money/transactions">View transactions</Link>
            </p>
            <Button
              type="submit"
              variant="outline"
              name="intent"
              value="restart"
              onClick={() => setFile(null)}
              className="self-start"
            >
              Import another file
            </Button>
          </form>
        );
    }
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
      <FieldGroup>
        <h2>{state.profileId ? "Edit the import profile" : "Map the columns"}</h2>
        {!state.profileId && (
          <p className="text-muted-foreground">
            troba hasn&apos;t seen this format yet. Say which column holds what, once: it&apos;s
            saved as a profile, and later files with the same columns use it.
          </p>
        )}
        <Field>
          <FieldLabel htmlFor="profile-name">Profile name</FieldLabel>
          <Input
            id="profile-name"
            name="name"
            defaultValue={value("name")}
            maxLength={100}
            required
          />
        </Field>
        <FieldSet>
          <FieldLegend>Reading the file</FieldLegend>
          <Field>
            <FieldLabel htmlFor="profile-skip-lines">Lines above the header</FieldLabel>
            <Input
              id="profile-skip-lines"
              name="skipLines"
              type="number"
              min={0}
              max={100}
              defaultValue={value("skipLines")}
              aria-describedby="profile-skip-lines-hint"
              className="max-w-24"
            />
            <FieldDescription id="profile-skip-lines-hint">
              Banks may put a title above the column names. Change it if the headers below look
              wrong, then read the file again.
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="profile-delimiter">Delimiter</FieldLabel>
            <NativeSelect id="profile-delimiter" name="delimiter" defaultValue={value("delimiter")}>
              <NativeSelectOption value="detect">Detect</NativeSelectOption>
              <NativeSelectOption value=";">Semicolon ;</NativeSelectOption>
              <NativeSelectOption value=",">Comma ,</NativeSelectOption>
              <NativeSelectOption value="tab">Tab</NativeSelectOption>
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor="profile-encoding">Encoding</FieldLabel>
            <Input
              id="profile-encoding"
              name="encoding"
              defaultValue={value("encoding")}
              maxLength={40}
              spellCheck={false}
              aria-describedby="profile-encoding-hint"
            />
            <FieldDescription id="profile-encoding-hint">
              utf-8 for most banks; older ones may use a code page such as windows-1252.
            </FieldDescription>
          </Field>
          {/* Before any column is mapped: the headers to map may be the wrong ones. */}
          <Button
            type="submit"
            variant="outline"
            name="intent"
            value="reread"
            disabled={pending}
            formNoValidate
            className="self-start"
          >
            Read the file again
          </Button>
        </FieldSet>
        {table && <FilePreview table={table} />}
        <FieldSet>
          <FieldLegend>Numbers and dates</FieldLegend>
          <Field>
            <FieldLabel htmlFor="profile-decimal">Decimal separator</FieldLabel>
            <NativeSelect
              id="profile-decimal"
              name="decimalSeparator"
              defaultValue={value("decimalSeparator")}
            >
              <NativeSelectOption value=".">Point: 1,234.56</NativeSelectOption>
              <NativeSelectOption value=",">Comma: 1.234,56</NativeSelectOption>
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor="profile-date-format">Date format</FieldLabel>
            <NativeSelect
              id="profile-date-format"
              name="dateFormat"
              defaultValue={value("dateFormat")}
            >
              {dateFormats.map((format) => (
                <NativeSelectOption key={format} value={format}>
                  {format}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
        </FieldSet>
        <FieldSet>
          <FieldLegend>Columns</FieldLegend>
          {(Object.keys(importFields) as ImportField[]).map((field) => (
            <ColumnSelect
              key={field}
              field={field}
              headers={table?.headers ?? []}
              defaultValue={value(`column.${field}`)}
            />
          ))}
          <Field>
            <FieldLabel htmlFor="profile-debit-values">Debit values</FieldLabel>
            <Input
              id="profile-debit-values"
              name="debitValues"
              defaultValue={value("debitValues")}
              maxLength={200}
              aria-describedby="profile-debit-values-hint"
            />
            <FieldDescription id="profile-debit-values-hint">
              With a debit/credit column: the values that mean money went out, comma-separated, such
              as D.
            </FieldDescription>
          </Field>
        </FieldSet>
        {state.error && <FormError>{state.error}</FormError>}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" name="intent" value="save" disabled={pending || !table}>
            Save profile and preview
          </Button>
          <Button type="submit" variant="outline" name="intent" value="restart" formNoValidate>
            Start over
          </Button>
        </div>
      </FieldGroup>
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
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <NativeSelect
        id={id}
        name={`column.${field}`}
        defaultValue={headers.includes(defaultValue) ? defaultValue : ""}
        required={required}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="w-full sm:w-fit"
      >
        <NativeSelectOption value="">
          {required ? "Pick a column" : "Not in this file"}
        </NativeSelectOption>
        {headers.map((header, i) => (
          <NativeSelectOption key={i} value={header}>
            {header}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      {hint && <FieldDescription id={`${id}-hint`}>{hint}</FieldDescription>}
    </Field>
  );
}

function FilePreview({ table }: { table: MappingTable }) {
  return (
    // Scrolls on its own, so a wide statement doesn't widen the page on a phone.
    <Table
      containerProps={{
        role: "region",
        "aria-labelledby": "file-preview",
        tabIndex: 0,
        className: "rounded-xl ring-1 ring-foreground/10",
      }}
    >
      <TableCaption id="file-preview" className="mb-2 caption-top">
        The file as read: {table.headers.length} columns, {delimiterNames[table.delimiter]}
      </TableCaption>
      <TableHeader>
        <TableRow>
          {table.headers.map((header, i) => (
            <TableHead key={i} scope="col">
              {header}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {table.sampleRows.map((row, i) => (
          <TableRow key={i}>
            {table.headers.map((_, j) => (
              <TableCell key={j}>{row[j]}</TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
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
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <input type="hidden" name="profileId" value={state.profile.id} />
      <h2>Preview</h2>
      <p className="flex flex-wrap items-center gap-2">
        Read with the profile {state.profile.name}.{" "}
        <Button
          type="submit"
          variant="outline"
          size="sm"
          name="intent"
          value="edit"
          disabled={pending}
          formNoValidate
        >
          Edit profile
        </Button>
      </p>
      <PreviewBody preview={preview} accountId={state.accountId} pending={pending} />
      {state.error && <FormError>{state.error}</FormError>}
      <p>
        <Button type="submit" variant="outline" name="intent" value="restart" formNoValidate>
          Start over
        </Button>
      </p>
    </form>
  );
}

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
            <p className="[overflow-wrap:anywhere]">
              This file is for the account with IBAN {preview.iban} ({preview.currency}), which you
              don&apos;t have in troba yet.
            </p>
            <Field>
              <FieldLabel htmlFor="import-account-name">Account name</FieldLabel>
              <Input
                id="import-account-name"
                name="accountName"
                maxLength={100}
                defaultValue="Bank account"
                required
              />
            </Field>
            <Button
              type="submit"
              name="intent"
              value="create-account"
              disabled={pending}
              className="self-start"
            >
              Create the account and preview
            </Button>
          </>
        );
      case "account-required":
        return (
          <>
            <p>This file doesn&apos;t say which account it&apos;s for.</p>
            {preview.accounts.length === 0 && (
              <p>
                You have no account to import into.{" "}
                <Link href="/money/accounts">Create one on the Accounts page</Link>, then start
                over.
              </p>
            )}
            <Field>
              <FieldLabel htmlFor="import-account">Account</FieldLabel>
              <NativeSelect id="import-account" name="accountId" required defaultValue="">
                <NativeSelectOption value="" disabled>
                  Pick an account
                </NativeSelectOption>
                {preview.accounts.map((account) => (
                  <NativeSelectOption key={account.id} value={account.id}>
                    {account.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Button
              type="submit"
              name="intent"
              value="preview"
              disabled={pending}
              className="self-start"
            >
              Preview
            </Button>
          </>
        );
      case "refused":
        return <FormError>{preview.message}</FormError>;
    }
  }

  const { failed, rowsFailed } = preview;
  return (
    <>
      <input type="hidden" name="accountId" value={accountId ?? ""} />
      <p>Account: {preview.account.name}</p>
      <DescriptionList aria-label="Import summary">
        <dt>Rows in the file</dt>
        <dd>{preview.rowsParsed}</dd>
        <dt>New</dt>
        <dd>{preview.rowsNew}</dd>
        <dt>Already imported, skipped</dt>
        <dd>{preview.rowsDuplicate}</dd>
        <dt>Can&apos;t be read</dt>
        <dd>{rowsFailed}</dd>
      </DescriptionList>
      {preview.debitCredit && (
        <>
          <p id="debit-credit">Debit/credit values in the file. Check they read the right way:</p>
          <ul aria-labelledby="debit-credit" className="list-disc pl-6 text-sm">
            {preview.debitCredit.map(({ value, debit, rows }) => (
              <li key={value}>
                {value}: {count(rows, "row")}, read as {debit ? "money out" : "money in"}
              </li>
            ))}
          </ul>
        </>
      )}
      {rowsFailed > 0 && (
        <>
          <p id="failed-rows">These rows can&apos;t be read and won&apos;t be imported:</p>
          <ul aria-labelledby="failed-rows" className="list-disc pl-6 text-sm">
            {failed.map(({ row, reason }) => (
              <li key={row}>
                Row {row}: {failureReasons[reason]}
              </li>
            ))}
          </ul>
          {rowsFailed > failed.length && <p>And {rowsFailed - failed.length} more.</p>}
        </>
      )}
      {preview.rowsNew > 0 ? (
        <Button
          type="submit"
          name="intent"
          value="commit"
          disabled={pending}
          className="self-start"
        >
          Import {count(preview.rowsNew, "transaction")}
        </Button>
      ) : (
        <FormStatus>Nothing new to import.</FormStatus>
      )}
    </>
  );
}

function count(n: number, noun: string) {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
