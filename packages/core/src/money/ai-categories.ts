import { schema, type Db } from "@troba/db";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { aiCategorizationEnabledFor } from "./ai-categorization-setting";
import { maskMerchantText } from "./ai-categories-mask";
import { listCategories } from "./categories";
import { listRules, matchingRule } from "./rules";

// AI-suggested categories for the transactions no rule matched (SPEC-money M5, ADR-0016). The
// merchants of eligible rows go to an injected model client, masked; each valid answer is stored
// as a suggestion on the merchant's rows. A suggestion is not a category: the rows stay
// uncategorized and out of the category totals until the user accepts it.
//
// Nothing here logs, and nothing may: the payload is a user's merchant text and the answer is a
// guess about it. Every failure, including a client that throws, is the same quiet "failed".

const { moneyTransactions, users } = schema;

// ---- The port ----

export type CategorizationPayload = {
  // The user's categories, their own ids as the references the model answers with. Transfers (the
  // category excluded from spending) is never offered.
  categories: { id: string; name: string }[];
  // One entry per merchant. The id is only good within this request.
  merchants: { id: string; counterparty: string | null; description: string | null }[];
};

// What the model client is asked. The client sends it as it is; it adds nothing from the user's
// data.
export type CategorizationRequest = {
  instructions: string;
  payload: CategorizationPayload;
  // JSON Schema of the answer.
  schema: Record<string, unknown>;
  // Aborted when the time is up; a client that ignores it is still cut off.
  signal: AbortSignal;
};

// Resolves to the model's structured answer, unchecked: it is untrusted until readCategoryAnswer
// has validated it. Rejects on any failure.
export type CategorizationModelClient = {
  suggestCategories(request: CategorizationRequest): Promise<unknown>;
};

// ---- The answer ----

const none = "none";

// The answer's shape, for the model: one entry per merchant, a category id or "none". The ids are
// plain strings here; what makes one valid is that it is one of the user's, which only the
// engine knows.
const answerSchema = z.strictObject({
  answers: z.array(z.strictObject({ merchant: z.string(), category: z.string() })),
});

// Without the $schema key, which OpenAI's strict mode doesn't take.
export const categorizationAnswerJsonSchema: Record<string, unknown> = Object.fromEntries(
  Object.entries(z.toJSONSchema(answerSchema)).filter(([key]) => key !== "$schema"),
);

export const categorizationInstructions = [
  "You suggest a spending category for each merchant of a bank statement.",
  "You get the list of categories, each with an id and a name, and a list of merchants, each with an id, a counterparty and a description.",
  "Some text is masked: [NAME], [IBAN] and [NUMBER] stand for a person's name, an account number and a long number. Never ask for the real text.",
  `For each merchant answer with the id of the one category that fits it best, copied exactly, or "${none}" when you can't tell or none of the categories fits. Never invent an id.`,
].join("\n");

// The model's answer, unchecked, as a map from merchant id to a category id, or null for "none".
// Only entries that hold up are in it: the merchant was asked about, appears once, and the answer
// is the id of one of the user's categories or "none". Anything else reads as nothing for that
// merchant. An answer with no list of answers at all is null: the call produced nothing usable.
// Nothing here throws.
export function readCategoryAnswer(
  answer: unknown,
  merchantIds: ReadonlySet<string>,
  categoryIds: ReadonlySet<string>,
): Map<string, string | null> | null {
  const answers = (answer as { answers?: unknown } | null | undefined)?.answers;
  if (!Array.isArray(answers)) return null;

  const read = new Map<string, string | null>();
  const seen = new Set<string>();
  for (const entry of answers as unknown[]) {
    if (typeof entry !== "object" || entry === null) continue;
    const { merchant, category } = entry as { merchant?: unknown; category?: unknown };
    if (typeof merchant !== "string" || !merchantIds.has(merchant)) continue;
    if (seen.has(merchant)) {
      // Two answers for one merchant: neither is trusted.
      read.delete(merchant);
      continue;
    }
    seen.add(merchant);
    if (category === none) read.set(merchant, null);
    else if (typeof category === "string" && categoryIds.has(category))
      read.set(merchant, category);
  }
  return read;
}

// ---- The run ----

// Merchants in one request.
export const categorizationBatchSize = 50;
// Merchants one run handles; the rest wait for the next run.
export const maxMerchantsPerRun = 200;
export const defaultCategorizationTimeoutMs = 30_000;

// Candidate rows read per page, and ids per update.
const pageSize = 5000;

export type SuggestCategoriesOptions = {
  client: CategorizationModelClient;
  // Only the rows of this import (T136 runs it after an import is saved). Absent: all the user's.
  importId?: string;
  maxMerchants?: number;
  // For each request.
  timeoutMs?: number;
};

export type SuggestCategoriesResult = {
  // Merchants sent to the model and answered, with or without a suggestion.
  merchantsAsked: number;
  // Rows that now carry a suggestion.
  rowsSuggested: number;
  // A request failed, timed out or came back unusable: the run stopped there and what it didn't
  // answer is unmarked, to be asked again.
  failed: boolean;
};

type Merchant = {
  counterparty: string | null;
  description: string | null;
  rowIds: string[];
};

// Asks the model for a category for each merchant of the user's eligible rows, a batch at a time,
// and stores what it answers validly as suggestions. Eligible: no category, no rule match, a
// card or merchant row (an imported one with no counterparty IBAN, so not a direct transfer) with
// some text, and never asked about. Rows of one merchant, by counterparty ignoring case (the
// description when there is none), are asked once. Never throws.
//
// A user who turned AI categorization off (setting on the user, default on) is the first check:
// nothing is read for them and the client is never called, whoever calls this. It is checked again
// before each request, so opting out stops a run that is under way. The result is then the
// "nothing to ask" one.
export async function suggestCategories(
  db: Db,
  userId: string,
  options: SuggestCategoriesOptions,
): Promise<SuggestCategoriesResult> {
  const {
    client,
    importId,
    maxMerchants = maxMerchantsPerRun,
    timeoutMs = defaultCategorizationTimeoutMs,
  } = options;
  const result: SuggestCategoriesResult = { merchantsAsked: 0, rowsSuggested: 0, failed: false };

  try {
    if (!(await aiCategorizationEnabledFor(db, userId))) return result;
    const categories = (await listCategories(db, userId)).filter(
      (category) => !category.excludedFromSpending,
    );
    if (categories.length === 0) return result;
    const categoryIds = new Set(categories.map((category) => category.id));
    const [user] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId));
    const ownName = user?.name ?? "";

    const merchants = await findMerchants(db, userId, { importId, limit: maxMerchants });
    for (let i = 0; i < merchants.length; i += categorizationBatchSize) {
      if (i > 0 && !(await aiCategorizationEnabledFor(db, userId))) return result;
      const batch = merchants.slice(i, i + categorizationBatchSize);
      const ids = batch.map((_merchant, index) => `m${index + 1}`);
      const payload: CategorizationPayload = {
        categories: categories.map(({ id, name }) => ({ id, name })),
        merchants: batch.map((merchant, index) => ({
          id: ids[index]!,
          counterparty: merchant.counterparty && maskMerchantText(merchant.counterparty, ownName),
          description: merchant.description && maskMerchantText(merchant.description, ownName),
        })),
      };

      const answered = await ask(client, payload, timeoutMs).then(
        (answer) => readCategoryAnswer(answer, new Set(ids), categoryIds),
        () => null,
      );
      if (!answered) return { ...result, failed: true };

      result.merchantsAsked += batch.length;
      result.rowsSuggested += await store(
        db,
        userId,
        batch.map((merchant, index) => ({
          rowIds: merchant.rowIds,
          // A merchant the answer didn't cover is asked about and has no suggestion, like "none".
          categoryId: answered.get(ids[index]!) ?? null,
        })),
      );
    }
    return result;
  } catch {
    return { ...result, failed: true };
  }
}

async function ask(
  client: CategorizationModelClient,
  payload: CategorizationPayload,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("The model client timed out."));
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      client.suggestCategories({
        instructions: categorizationInstructions,
        payload,
        schema: categorizationAnswerJsonSchema,
        signal: controller.signal,
      }),
      timedOut,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// The candidates' merchants, oldest rows first, and the ids of each one's rows. Candidates are
// read a page at a time, keyed on (booked_on, id) like applyRulesToUncategorized, so a long
// history is never loaded at once: only the text of the first `limit` merchants is kept, and the
// ids of their rows. The rest of the pages are still read, since a merchant's rows can be anywhere
// in them.
async function findMerchants(
  db: Db,
  userId: string,
  options: { importId: string | undefined; limit: number },
): Promise<Merchant[]> {
  const rules = await listRules(db, userId);
  const merchants = new Map<string, Merchant>();
  let after: { bookedOn: string; id: string } | undefined;
  for (;;) {
    const page = await db
      .select({
        id: moneyTransactions.id,
        bookedOn: moneyTransactions.bookedOn,
        counterparty: moneyTransactions.counterparty,
        description: moneyTransactions.description,
      })
      .from(moneyTransactions)
      .where(
        and(
          eq(moneyTransactions.userId, userId),
          isNull(moneyTransactions.categoryId),
          isNull(moneyTransactions.suggestedCategoryId),
          isNull(moneyTransactions.suggestionAskedAt),
          // Imported rows only: a note typed by hand stays on the server.
          eq(moneyTransactions.source, "csv_import"),
          // A direct transfer: the other party is usually a person.
          sql`coalesce(btrim(${moneyTransactions.counterpartyIban}), '') = ''`,
          sql`coalesce(nullif(btrim(${moneyTransactions.counterparty}), ''), nullif(btrim(${moneyTransactions.description}), '')) is not null`,
          options.importId ? eq(moneyTransactions.importId, options.importId) : undefined,
          after &&
            sql`(${moneyTransactions.bookedOn}, ${moneyTransactions.id}) > (${after.bookedOn}, ${after.id})`,
        ),
      )
      .orderBy(asc(moneyTransactions.bookedOn), asc(moneyTransactions.id))
      .limit(pageSize);
    if (page.length === 0) break;
    after = page.at(-1)!;

    for (const row of page) {
      // A rule would categorize this row; it needs no model.
      if (matchingRule(rules, row)) continue;
      const counterparty = row.counterparty?.trim() || null;
      const description = row.description?.trim() || null;
      const key = (counterparty ?? description)!.toLowerCase();
      let merchant = merchants.get(key);
      if (!merchant) {
        if (merchants.size >= options.limit) continue;
        merchant = { counterparty, description, rowIds: [] };
        merchants.set(key, merchant);
      }
      merchant.description ??= description;
      merchant.rowIds.push(row.id);
    }
  }
  return [...merchants.values()];
}

// Marks the rows as asked and gives each its merchant's suggestion. Only rows that are still
// uncategorized and unasked are touched, so a category set in the meantime, or another run's
// answer, is kept. The category is read again in the update, so one deleted or foreign since the
// answer is no suggestion rather than an error. Returns the number of rows that got a suggestion.
async function store(
  db: Db,
  userId: string,
  merchants: { rowIds: string[]; categoryId: string | null }[],
): Promise<number> {
  return db.transaction(async (tx) => {
    let suggested = 0;
    for (const { rowIds, categoryId } of merchants) {
      for (let i = 0; i < rowIds.length; i += pageSize) {
        const updated = await tx
          .update(moneyTransactions)
          .set({
            suggestedCategoryId: categoryId
              ? sql`(select id from money_categories where id = ${categoryId} and user_id = ${userId})`
              : null,
            suggestionAskedAt: sql`now()`,
          })
          .where(
            and(
              eq(moneyTransactions.userId, userId),
              inArray(moneyTransactions.id, rowIds.slice(i, i + pageSize)),
              isNull(moneyTransactions.categoryId),
              isNull(moneyTransactions.suggestionAskedAt),
            ),
          )
          .returning({ suggested: moneyTransactions.suggestedCategoryId });
        suggested += updated.filter((row) => row.suggested !== null).length;
      }
    }
    return suggested;
  });
}
