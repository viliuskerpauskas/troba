import { schema, type Db, type DbTransaction } from "@troba/db";
import { and, asc, count, eq, inArray, isNull, max, sql } from "drizzle-orm";

// Auto-categorization rules (SPEC-money M5): a field contains text, case-insensitive → a category.
// Rules are ordered and the first match wins. They only fill a missing category: one set by hand,
// by transfer detection or by an earlier rule is never overwritten.

const { moneyCategories, moneyRules, moneyTransactions } = schema;

export const ruleFields = schema.ruleFields;
export type RuleField = (typeof ruleFields)[number];

// What matching needs of a rule.
export type RuleMatcher = { id: string; field: RuleField; pattern: string; categoryId: string };

// What matching needs of a transaction.
export type RuleTarget = { counterparty: string | null; description: string | null };

export type Rule = RuleMatcher & { categoryName: string };

// Rules are written by hand, so a user never needs more; the cap bounds every read of them.
export const maxRules = 500;

export const ruleMoveDirections = ["up", "down"] as const;
export type RuleMoveDirection = (typeof ruleMoveDirections)[number];

// Rules in their order; the first whose field contains its pattern, or null.
export function matchingRule(
  rules: readonly RuleMatcher[],
  target: RuleTarget,
): RuleMatcher | null {
  return (
    rules.find((rule) => target[rule.field]?.toLowerCase().includes(rule.pattern.toLowerCase())) ??
    null
  );
}

// The category the first matching rule gives, as a transaction's columns; nothing when none match.
export function ruleCategory(rules: readonly RuleMatcher[], target: RuleTarget) {
  const rule = matchingRule(rules, target);
  return rule ? { categoryId: rule.categoryId, categorySource: "rule" as const } : {};
}

export type NewRule = { field: RuleField; pattern: string; categoryId: string };

// "Create rule from this" on a transaction (SPEC-money M5): its counterparty, or its description
// when it has none.
export function ruleDraftFrom(target: RuleTarget): Partial<Omit<NewRule, "categoryId">> {
  if (target.counterparty) return { field: "counterparty", pattern: target.counterparty };
  if (target.description) return { field: "description", pattern: target.description };
  return {};
}

const matcherColumns = {
  id: moneyRules.id,
  field: moneyRules.field,
  pattern: moneyRules.pattern,
  categoryId: moneyRules.categoryId,
};

// First match wins, so every read of the rules agrees on this order.
const ruleOrder = [asc(moneyRules.position), asc(moneyRules.createdAt), asc(moneyRules.id)];

// The user's rules in order, with their category names. Served by money_rules_user_id_position_idx.
export async function listRules(db: Db | DbTransaction, userId: string): Promise<Rule[]> {
  return db
    .select({ ...matcherColumns, categoryName: moneyCategories.name })
    .from(moneyRules)
    .innerJoin(
      moneyCategories,
      and(eq(moneyCategories.id, moneyRules.categoryId), eq(moneyCategories.userId, userId)),
    )
    .where(eq(moneyRules.userId, userId))
    .orderBy(...ruleOrder)
    .limit(maxRules);
}

// Serializes changes to one user's rule order until the transaction ends. Row locks can't do it:
// a create counts rows and takes the last position, and a row that doesn't exist yet can't be
// locked, so two creates at once could pass the cap or share a position.
async function lockRules(tx: DbTransaction, userId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`money_rules:${userId}`}))`);
}

export type CreateRuleResult =
  | { ok: true; rule: Rule }
  | { ok: false; reason: "empty-pattern" | "category-not-found" | "too-many-rules" };

// A new rule goes last. The category is an id from the client: it must be the user's.
export async function createRule(
  db: Db,
  userId: string,
  input: NewRule,
): Promise<CreateRuleResult> {
  const pattern = input.pattern.trim();
  if (!pattern) return { ok: false, reason: "empty-pattern" };

  return db.transaction(async (tx) => {
    const [category] = await tx
      .select({ name: moneyCategories.name })
      .from(moneyCategories)
      .where(and(eq(moneyCategories.id, input.categoryId), eq(moneyCategories.userId, userId)));
    if (!category) return { ok: false, reason: "category-not-found" };

    await lockRules(tx, userId);
    const [existing] = await tx
      .select({ ruleCount: count(), lastPosition: max(moneyRules.position) })
      .from(moneyRules)
      .where(eq(moneyRules.userId, userId));
    if (existing!.ruleCount >= maxRules) return { ok: false, reason: "too-many-rules" };

    const [created] = await tx
      .insert(moneyRules)
      .values({
        userId,
        field: input.field,
        pattern,
        categoryId: input.categoryId,
        position: (existing!.lastPosition ?? 0) + 1,
      })
      .returning(matcherColumns);
    return { ok: true, rule: { ...created!, categoryName: category.name } };
  });
}

// Swaps the rule with its neighbour in the order; a rule already at that end stays. Returns
// whether the user has a rule with that id. Positions are renumbered from 1, so gaps left by
// deletes go away; only rows whose position changes are written.
export async function moveRule(
  db: Db,
  userId: string,
  input: { ruleId: string; direction: RuleMoveDirection },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    await lockRules(tx, userId);
    const rules = await tx
      .select({ id: moneyRules.id, position: moneyRules.position })
      .from(moneyRules)
      .where(eq(moneyRules.userId, userId))
      .orderBy(...ruleOrder)
      .limit(maxRules);
    const index = rules.findIndex((rule) => rule.id === input.ruleId);
    if (index === -1) return false;

    const neighbour = input.direction === "up" ? index - 1 : index + 1;
    if (neighbour >= 0 && neighbour < rules.length) {
      [rules[index], rules[neighbour]] = [rules[neighbour]!, rules[index]!];
    }
    for (const [i, rule] of rules.entries()) {
      if (rule.position === i + 1) continue;
      await tx
        .update(moneyRules)
        .set({ position: i + 1 })
        .where(and(eq(moneyRules.id, rule.id), eq(moneyRules.userId, userId)));
    }
    return true;
  });
}

// Returns whether one of the user's rules was deleted. Transactions it categorized keep their
// category.
export async function deleteRule(
  db: Db,
  userId: string,
  input: { ruleId: string },
): Promise<boolean> {
  const deleted = await db
    .delete(moneyRules)
    .where(and(eq(moneyRules.id, input.ruleId), eq(moneyRules.userId, userId)))
    .returning({ id: moneyRules.id });
  return deleted.length > 0;
}

// Uncategorized transactions read per page.
const applyBatchSize = 5000;

// Gives every uncategorized transaction of the user the category of its first matching rule.
// Returns how many were categorized. Pages are keyed on (booked_on, id): a row a rule doesn't
// match stays uncategorized, so paging by offset or by "still uncategorized" would skip or reread
// rows. money_transactions_user_id_booked_on_idx serves user_id and booked_on >=; the id tie-break
// and category_id is null are filtered within the user's rows.
export async function applyRulesToUncategorized(db: Db, userId: string): Promise<number> {
  return db.transaction(async (tx) => {
    const rules = await listRules(tx, userId);
    if (rules.length === 0) return 0;

    let categorized = 0;
    let after: { bookedOn: string; id: string } | undefined;
    for (;;) {
      const page = await tx
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
            after &&
              sql`(${moneyTransactions.bookedOn}, ${moneyTransactions.id}) > (${after.bookedOn}, ${after.id})`,
          ),
        )
        .orderBy(asc(moneyTransactions.bookedOn), asc(moneyTransactions.id))
        .limit(applyBatchSize);
      if (page.length === 0) return categorized;

      categorized += await categorize(tx, userId, rules, page);
      after = page.at(-1)!;
    }
  });
}

// One update per category the rules picked, guarded so a category set meanwhile is kept.
async function categorize(
  tx: DbTransaction,
  userId: string,
  rules: readonly RuleMatcher[],
  transactions: readonly (RuleTarget & { id: string })[],
): Promise<number> {
  const idsByCategory = new Map<string, string[]>();
  for (const transaction of transactions) {
    const rule = matchingRule(rules, transaction);
    if (!rule) continue;
    const ids = idsByCategory.get(rule.categoryId) ?? [];
    ids.push(transaction.id);
    idsByCategory.set(rule.categoryId, ids);
  }

  let categorized = 0;
  for (const [categoryId, ids] of idsByCategory) {
    const updated = await tx
      .update(moneyTransactions)
      .set({ categoryId, categorySource: "rule" })
      .where(
        and(
          eq(moneyTransactions.userId, userId),
          inArray(moneyTransactions.id, ids),
          isNull(moneyTransactions.categoryId),
        ),
      )
      .returning({ id: moneyTransactions.id });
    categorized += updated.length;
  }
  return categorized;
}
