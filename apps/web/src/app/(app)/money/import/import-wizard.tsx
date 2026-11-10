"use client";

import type { AfterImportSuggestions, DateFormat, ImportField } from "@troba/core";
import Link from "next/link";
import {
  startTransition,
  useActionState,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Badge } from "@/components/ui/badge";
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
import { cn } from "@/lib/utils";
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
  commitPdfImportAction,
  createImportAccountAction,
  createPdfImportAccountAction,
  discardPdfImportAction,
  editProfileAction,
  pdfImportStatusAction,
  previewImportAction,
  previewPdfImportAction,
  rereadMappingAction,
  saveProfileAction,
  startImportAction,
  startPdfImportAction,
  type ImportState,
  type MappingTable,
  type PreviewView,
} from "./actions";
import { importFields, requiredFields } from "./fields";
import {
  acceptedFiles,
  acceptedFilesWithPdf,
  acceptedFileTypes,
  acceptedFileTypesWithPdf,
  afterImportNote,
  failureReasons,
  formatSourceBadges,
  formatSourceNotes,
  suggestionNotes,
  tooLargeMessage,
  type Suggestion,
} from "./messages";

// Each submit button names the step it runs.
const actions = {
  start: startImportAction,
  reread: rereadMappingAction,
  save: saveProfileAction,
  edit: editProfileAction,
  preview: previewImportAction,
  "create-account": createImportAccountAction,
  commit: commitImportAction,
  // A PDF statement's steps (ADR-0018).
  "pdf-confirm": startPdfImportAction,
  "pdf-status": pdfImportStatusAction,
  "pdf-preview": previewPdfImportAction,
  "pdf-create-account": createPdfImportAccountAction,
  "pdf-commit": commitPdfImportAction,
  "pdf-discard": discardPdfImportAction,
} satisfies Record<string, (formData: FormData) => Promise<ImportState>>;

const firstStep: ImportState = { step: "upload" };

// How often the page asks whether the worker has read the PDF.
const pdfPollMs = 2_000;

async function run(state: ImportState, formData: FormData): Promise<ImportState> {
  const intent = String(formData.get("intent"));
  if (intent === "restart") return { step: "upload" };
  return Object.hasOwn(actions, intent) ? actions[intent as keyof typeof actions](formData) : state;
}

export function ImportWizard({
  dateFormats,
  maxBytes,
  aiEnabled,
  categorizeEnabled,
  pdfEnabled,
  resumed,
}: {
  dateFormats: readonly DateFormat[];
  maxBytes: number;
  // The server has a key for AI-suggested mappings, so the upload step says what is sent.
  aiEnabled: boolean;
  // The server has a key and this user hasn't opted out of AI-suggested categories, so the upload
  // step says what is sent for them, before the file is chosen.
  categorizeEnabled: boolean;
  // The server can read PDF statements, so the upload step takes one.
  pdfEnabled: boolean;
  // A PDF import the user started earlier, which the page picks up again.
  resumed?: ImportState;
}) {
  const [initial] = useState(resumed ?? firstStep);
  const [state, dispatch, pending] = useActionState(run, initial);
  // The file the user chose, sent again with every step: the server keeps nothing between them.
  const [file, setFile] = useState<File | null>(null);
  const [tooLarge, setTooLarge] = useState(false);
  const stepStart = useRef<HTMLDivElement>(null);

  // The button that ran a step is gone once the next one renders, which drops focus to the page:
  // put it at the start of the step instead, so a keyboard user carries on from there. Not on the
  // page load's first step (restarting gives a new state object), which would steal focus. A
  // refused submit moves it too: its disabled button lost focus while pending.
  useEffect(() => {
    if (state !== initial && document.activeElement === document.body) stepStart.current?.focus();
  }, [state, initial]);

  // While the worker reads a PDF, ask where it stands: at once for one picked up on page load,
  // then every few seconds until it is read or failed.
  const readingId = state.step === "pdf-reading" ? state.pdfImportId : null;
  useEffect(() => {
    if (!readingId || pending) return;
    const timer = setTimeout(
      () => {
        const data = new FormData();
        data.set("intent", "pdf-status");
        data.set("pdfImportId", readingId);
        startTransition(() => dispatch(data));
      },
      state === initial ? 0 : pdfPollMs,
    );
    return () => clearTimeout(timer);
  }, [readingId, pending, state, initial, dispatch]);

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

  // The note on how the step after the upload was reached, spoken once when it arrives: the AI
  // suggestion's on the mapping step, how the profile was found on the preview. It goes in a live
  // region that is already on the page: one inserted together with its text is often not
  // announced. Not role="status", which the step's own messages (FormStatus) use.
  const suggestion = state.step === "mapping" ? state.suggestion : undefined;
  const found = state.step === "preview" ? state.found : undefined;
  // The same, for the note under the import result.
  const importNote = state.step === "done" ? afterImportNote(state.suggestions) : null;

  return (
    <>
      <p aria-live="polite" aria-atomic="true" className="sr-only">
        {suggestion ? noteText(suggestion) : found ? formatSourceNotes[found] : importNote}
      </p>
      <div ref={stepStart} tabIndex={-1} className="outline-none">
        {renderStep()}
      </div>
    </>
  );

  function renderStep() {
    const describedBy = [
      aiEnabled && "import-ai-disclosure",
      categorizeEnabled && "import-categorize-disclosure",
    ]
      .filter(Boolean)
      .join(" ");
    switch (state.step) {
      case "upload":
        return (
          <form onSubmit={submit}>
            <FieldGroup>
              <Field>
                {/* The drop area says what to do; the label stays for screen readers. */}
                <FieldLabel htmlFor="import-file" className="sr-only">
                  Statement file from your bank (
                  {pdfEnabled ? acceptedFileTypesWithPdf : acceptedFileTypes})
                </FieldLabel>
                <FileDrop
                  id="import-file"
                  pdfEnabled={pdfEnabled}
                  file={file}
                  describedBy={describedBy || undefined}
                  onFile={(chosen) => {
                    setFile(chosen);
                    setTooLarge(false);
                  }}
                />
                {aiEnabled && (
                  <FieldDescription id="import-ai-disclosure">
                    If troba doesn&apos;t know the file&apos;s format, its column names and a few
                    rows, with names, merchants and account numbers masked, are sent to an AI
                    service to suggest how to map the columns. Nothing is sent for formats troba
                    knows.
                  </FieldDescription>
                )}
                {categorizeEnabled && (
                  <FieldDescription id="import-categorize-disclosure">
                    After the import is saved, the counterparty and description of the new
                    transactions that no rule matched are sent to an AI service, with your own name
                    and account numbers masked, so it can suggest a category for each. Rows that
                    show the other party&apos;s IBAN (transfers) and manual entries are not sent. A
                    payment to a person that shows no IBAN is sent, and a name inside a merchant
                    string might get through. A suggestion never changes a category until you accept
                    it. You can turn this off in your settings.
                  </FieldDescription>
                )}
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
      case "pdf-confirm":
        return (
          <form onSubmit={submit} className="flex flex-col gap-4">
            <h2>Send this statement to AI?</h2>
            <p className="[overflow-wrap:anywhere]">
              troba reads PDF statements with an AI service. To import {state.filename}, the whole
              statement is sent to it, including every amount, the names of the people and shops in
              it, and account numbers. troba asks the service not to keep it. Nothing is sent unless
              you choose to.
            </p>
            {state.error && <FormError>{state.error}</FormError>}
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" name="intent" value="pdf-confirm" disabled={pending}>
                Send to AI and read it
              </Button>
              <Button
                type="submit"
                variant="outline"
                name="intent"
                value="restart"
                onClick={() => setFile(null)}
              >
                Don&apos;t send
              </Button>
            </div>
          </form>
        );
      case "pdf-reading":
        return (
          <form onSubmit={submit} className="flex flex-col gap-4">
            <input type="hidden" name="pdfImportId" value={state.pdfImportId} />
            <h2>Reading your statement</h2>
            <FormStatus>
              AI is reading {state.filename}. This can take a minute. You can leave this page and
              come back: the result will be here.
            </FormStatus>
            <Button
              type="submit"
              variant="outline"
              name="intent"
              value="pdf-discard"
              className="self-start"
            >
              Start over
            </Button>
          </form>
        );
      case "pdf-failed":
        return (
          <form onSubmit={submit} className="flex flex-col gap-4">
            <input type="hidden" name="pdfImportId" value={state.pdfImportId} />
            <h2>The statement couldn&apos;t be read</h2>
            <FormError>{state.message}</FormError>
            <Button
              type="submit"
              name="intent"
              value="pdf-discard"
              disabled={pending}
              className="self-start"
            >
              Try again
            </Button>
          </form>
        );
      case "pdf-preview":
        return <PdfPreviewForm state={state} pending={pending} onSubmit={submit} />;
      case "done":
        return (
          <form onSubmit={submit} className="flex flex-col gap-4">
            <FormStatus>
              Imported {count(state.rowsNew, "transaction")} into {state.accountName}.
              {state.rowsDuplicate > 0 &&
                ` Skipped ${count(state.rowsDuplicate, "row")} already imported.`}
              {state.rowsFailed > 0 && ` ${count(state.rowsFailed, "row")} couldn't be read.`}
            </FormStatus>
            <AfterImportNote suggestions={state.suggestions} />
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
      {state.suggestion && <input type="hidden" name="suggestion" value={state.suggestion} />}
      <FieldGroup>
        <h2>{state.profileId ? "Edit the import profile" : "Map the columns"}</h2>
        {/* A file at the profile limit is a known format: its note says so instead. */}
        {!state.profileId && state.suggestion !== "profile-limit" && (
          <p className="text-muted-foreground">
            troba hasn&apos;t seen this format yet. Say which column holds what, once: it&apos;s
            saved as a profile, and later files with the same columns use it.
          </p>
        )}
        {state.suggestion && <SuggestionNote suggestion={state.suggestion} />}
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
          {/* A spreadsheet has neither: its first sheet is read as it is. */}
          {state.fileKind === "csv" && (
            <>
              <Field>
                <FieldLabel htmlFor="profile-delimiter">Delimiter</FieldLabel>
                <NativeSelect
                  id="profile-delimiter"
                  name="delimiter"
                  defaultValue={value("delimiter")}
                >
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
            </>
          )}
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

// Shown under the import result. Screen readers get it from the wizard's live region (see
// ImportWizard), so it isn't one itself and is not read twice. Nothing when there is nothing to say.
export function AfterImportNote({ suggestions }: { suggestions: AfterImportSuggestions }) {
  const text = afterImportNote(suggestions);
  if (!text) return null;
  return <p className="rounded-lg border bg-muted px-3 py-2 text-sm">{text}</p>;
}

function noteText(suggestion: Suggestion): string {
  const { lead, text } = suggestionNotes[suggestion];
  return lead ? `${lead} ${text}` : text;
}

// Shown in the reading order, right after the step's heading. Screen readers get it from the
// wizard's live region (see ImportWizard), so it isn't one itself and is not read twice.
function Note({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border bg-muted px-3 py-2 text-sm">{children}</p>;
}

function SuggestionNote({ suggestion }: { suggestion: Suggestion }) {
  const { lead, text } = suggestionNotes[suggestion];
  return (
    <Note>
      {lead && <strong>{lead} </strong>}
      {text}
    </Note>
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
        The file as read: {table.headers.length} columns,{" "}
        {table.delimiter === null ? "from its first sheet" : delimiterNames[table.delimiter]}
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

const delimiterNames: Record<NonNullable<MappingTable["delimiter"]>, string> = {
  ",": "comma-separated",
  ";": "semicolon-separated",
  "\t": "tab-separated",
};

function PreviewForm({ state, pending, onSubmit }: StepProps<"preview">) {
  const { preview, profile, found } = state;
  const startOver = (
    <Button type="submit" variant="outline" name="intent" value="restart" formNoValidate>
      Start over
    </Button>
  );
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <input type="hidden" name="profileId" value={profile.id} />
      {found && <input type="hidden" name="found" value={found} />}
      <h2>Preview</h2>
      <div className="flex flex-col gap-1">
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Read with the profile</span>
          <Badge
            className="text-sm"
            variant={profile.brand ? null : "secondary"}
            style={
              profile.brand
                ? { backgroundColor: profile.brand.background, color: profile.brand.foreground }
                : undefined
            }
          >
            {profile.name}
          </Badge>
          {found && <Badge variant="outline">{formatSourceBadges[found]}</Badge>}
          <Button
            type="submit"
            variant="ghost"
            size="sm"
            name="intent"
            value="edit"
            disabled={pending}
            formNoValidate
          >
            Edit profile
          </Button>
        </p>
        {found === "preset" && (
          <p className="text-sm text-muted-foreground">
            It&apos;s now saved in your import profiles, so you can edit it.
          </p>
        )}
      </div>
      <PreviewBody
        preview={preview}
        accountId={state.accountId}
        pending={pending}
        error={state.error && <FormError>{state.error}</FormError>}
        startOver={startOver}
      />
    </form>
  );
}

// The step's own content, ending in one row of buttons: its next action, then Start over.
// The preview of a PDF statement the model read: the same body as a CSV's, on the stored answer.
function PdfPreviewForm({ state, pending, onSubmit }: StepProps<"pdf-preview">) {
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <input type="hidden" name="pdfImportId" value={state.pdfImportId} />
      <h2>Preview</h2>
      <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
        Read by AI from {state.filename}. AI can misread a statement, so check the numbers before
        you import.
      </p>
      <PreviewBody
        preview={state.preview}
        accountId={state.accountId}
        pending={pending}
        intentPrefix="pdf-"
        error={state.error && <FormError>{state.error}</FormError>}
        startOver={
          <Button type="submit" variant="outline" name="intent" value="pdf-discard" formNoValidate>
            Start over
          </Button>
        }
      />
    </form>
  );
}

function PreviewBody({
  preview,
  accountId,
  pending,
  intentPrefix = "",
  error,
  startOver,
}: {
  preview: PreviewView;
  accountId: string | null;
  pending: boolean;
  // Before each button's intent: a PDF's steps are actions of their own.
  intentPrefix?: "" | "pdf-";
  error: ReactNode;
  startOver: ReactNode;
}) {
  const actions = (primary?: ReactNode) => (
    <>
      {error}
      <div className="flex flex-wrap items-center gap-2">
        {primary}
        {startOver}
      </div>
    </>
  );

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
            {actions(
              <Button
                type="submit"
                name="intent"
                value={`${intentPrefix}create-account`}
                disabled={pending}
              >
                Create the account and preview
              </Button>,
            )}
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
            {actions(
              <Button
                type="submit"
                name="intent"
                value={`${intentPrefix}preview`}
                disabled={pending}
              >
                Preview
              </Button>,
            )}
          </>
        );
      case "refused":
        return (
          <>
            <FormError>{preview.message}</FormError>
            {actions()}
          </>
        );
    }
  }

  const { failed, rowsFailed } = preview;
  return (
    <>
      <input type="hidden" name="accountId" value={accountId ?? ""} />
      <p className="text-sm">
        <span className="text-muted-foreground">Account:</span> {preview.account.name}
      </p>
      <dl aria-label="Import summary" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat term="Rows in the file" value={preview.rowsParsed} />
        <Stat term="New" value={preview.rowsNew} tone={preview.rowsNew > 0 ? "strong" : "quiet"} />
        <Stat term="Already imported, skipped" value={preview.rowsDuplicate} tone="quiet" />
        <Stat term="Can't be read" value={rowsFailed} tone={rowsFailed > 0 ? "bad" : "quiet"} />
      </dl>
      {preview.debitCredit && (
        <section aria-labelledby="debit-credit" className="rounded-xl border p-3 sm:p-4">
          <h3 id="debit-credit" className="text-sm font-medium">
            Debit/credit values in the file
          </h3>
          <p className="text-sm text-muted-foreground">
            Check each value reads the right way. If one doesn&apos;t, edit the profile&apos;s debit
            values.
          </p>
          <ul aria-labelledby="debit-credit" className="mt-2 divide-y text-sm">
            {preview.debitCredit.map(({ value, debit, rows }) => (
              <li key={value} className="flex items-center gap-2 py-2">
                <code className="min-w-8 rounded-md bg-muted px-2 py-0.5 text-center font-mono">
                  {value}
                </code>{" "}
                <span className="text-muted-foreground">read as</span>{" "}
                <Badge variant="outline">
                  <span aria-hidden="true">{debit ? "↓" : "↑"}</span>
                  {debit ? "money out" : "money in"}
                </Badge>{" "}
                <span className="ml-auto text-muted-foreground tabular-nums">
                  {count(rows, "row")}
                </span>
              </li>
            ))}
          </ul>
        </section>
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
        actions(
          <Button type="submit" name="intent" value={`${intentPrefix}commit`} disabled={pending}>
            Import {count(preview.rowsNew, "transaction")}
          </Button>,
        )
      ) : (
        <>
          <FormStatus>Nothing new to import.</FormStatus>
          {actions()}
        </>
      )}
    </>
  );
}

// One figure of the summary: a dt and its dd, wrapped in a div, which a dl allows.
function Stat({
  term,
  value,
  tone,
}: {
  term: string;
  value: number;
  tone?: "strong" | "quiet" | "bad";
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-xl border p-3",
        tone === "strong" && "border-primary/40 bg-muted",
        tone === "bad" && "border-destructive/50",
      )}
    >
      <dt className="text-xs text-muted-foreground">{term}</dt>
      <dd
        className={cn(
          "text-2xl font-semibold tabular-nums",
          tone === "quiet" && "text-muted-foreground",
          tone === "bad" && "text-destructive",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

// The file field as a drop area. The input itself covers the area, transparent, so a click opens
// the file picker and a dropped file lands in it natively, with the keyboard focus ring on the
// area around it. Dragging over only changes how the area looks.
function FileDrop({
  id,
  pdfEnabled,
  file,
  describedBy,
  onFile,
}: {
  id: string;
  pdfEnabled: boolean;
  file: File | null;
  describedBy: string | undefined;
  onFile: (file: File | null) => void;
}) {
  const [over, setOver] = useState(false);
  return (
    <div
      onDragEnter={() => setOver(true)}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={() => setOver(false)}
      className={cn(
        "relative flex min-h-40 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors has-focus-visible:border-ring has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
        over ? "border-primary bg-muted" : "border-input hover:bg-muted/50",
      )}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="mb-1 size-8 text-muted-foreground"
      >
        <path d="M12 15V3m0 0L7.5 7.5M12 3l4.5 4.5" />
        <path d="M4 15v3a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-3" />
      </svg>
      {file ? (
        <>
          <p className="font-medium [overflow-wrap:anywhere]">{file.name}</p>
          <p className="text-sm text-muted-foreground">
            {fileSize(file.size)}. Drop another file or click to replace it.
          </p>
        </>
      ) : (
        <>
          <p className="font-medium">{over ? "Drop it here" : "Drag a statement file here"}</p>
          <p className="text-sm text-muted-foreground">
            {pdfEnabled ? acceptedFileTypesWithPdf : acceptedFileTypes}, or click to choose one
          </p>
        </>
      )}
      <input
        id={id}
        type="file"
        name="file"
        accept={pdfEnabled ? acceptedFilesWithPdf : acceptedFiles}
        required
        aria-describedby={describedBy}
        onChange={(event) => onFile(event.currentTarget.files?.[0] ?? null)}
        className="absolute inset-0 size-full cursor-pointer"
        // Inline, not opacity-0: the global focus-ring transition (globals.css) also fades opacity
        // and, being unlayered, beats a transition-none class, so the native "Choose File" text
        // would show on load and fade out.
        style={{ opacity: 0, transition: "none" }}
      />
    </div>
  );
}

function fileSize(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function count(n: number, noun: string) {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
