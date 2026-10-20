import { schema, type Db } from "@troba/db";
import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import { parseIban } from "./iban";

// Financial accounts (SPEC-money M1): where transactions live. Accounts are renamed and archived,
// never deleted, so their transactions keep counting in reports.

const { moneyAccounts } = schema;

export type Account = {
  id: string;
  name: string;
  type: schema.AccountType;
  currency: string;
  iban: string | null;
  archivedAt: Date | null;
};

export type CreateAccountInput = {
  name: string;
  type: schema.AccountType;
  // ISO 4217, upper case.
  currency: string;
  iban?: string | null;
};

export type CreateAccountResult =
  | { ok: true; account: Account }
  | { ok: false; reason: "invalid-iban" | "iban-not-bank" | "iban-taken" };

const columns = {
  id: moneyAccounts.id,
  name: moneyAccounts.name,
  type: moneyAccounts.type,
  currency: moneyAccounts.currency,
  iban: moneyAccounts.iban,
  archivedAt: moneyAccounts.archivedAt,
};

// The user's accounts, oldest first. Archived ones only when asked for: pickers leave them out.
export async function listAccounts(
  db: Db,
  userId: string,
  options: { includeArchived?: boolean } = {},
): Promise<Account[]> {
  return db
    .select(columns)
    .from(moneyAccounts)
    .where(
      and(
        eq(moneyAccounts.userId, userId),
        options.includeArchived ? undefined : isNull(moneyAccounts.archivedAt),
      ),
    )
    .orderBy(asc(moneyAccounts.createdAt), asc(moneyAccounts.id));
}

// The IBAN is optional, for bank accounts only, and unique per user (archived accounts included),
// since imports find the account by it.
export async function createAccount(
  db: Db,
  userId: string,
  input: CreateAccountInput,
): Promise<CreateAccountResult> {
  let iban: string | null = null;
  if (input.iban) {
    iban = parseIban(input.iban);
    if (!iban) return { ok: false, reason: "invalid-iban" };
    if (input.type !== "bank") return { ok: false, reason: "iban-not-bank" };
  }

  const [account] = await db
    .insert(moneyAccounts)
    .values({ userId, name: input.name.trim(), type: input.type, currency: input.currency, iban })
    .onConflictDoNothing({ target: [moneyAccounts.userId, moneyAccounts.iban] })
    .returning(columns);
  if (!account) return { ok: false, reason: "iban-taken" };
  return { ok: true, account };
}

// Returns whether the user has an account with that id.
export async function renameAccount(
  db: Db,
  userId: string,
  input: { accountId: string; name: string },
): Promise<boolean> {
  const renamed = await db
    .update(moneyAccounts)
    .set({ name: input.name.trim() })
    .where(and(eq(moneyAccounts.id, input.accountId), eq(moneyAccounts.userId, userId)))
    .returning({ id: moneyAccounts.id });
  return renamed.length > 0;
}

// Returns whether an active account of the user's was archived.
export async function archiveAccount(
  db: Db,
  userId: string,
  input: { accountId: string; now?: Date },
): Promise<boolean> {
  const archived = await db
    .update(moneyAccounts)
    .set({ archivedAt: input.now ?? new Date() })
    .where(
      and(
        eq(moneyAccounts.id, input.accountId),
        eq(moneyAccounts.userId, userId),
        isNull(moneyAccounts.archivedAt),
      ),
    )
    .returning({ id: moneyAccounts.id });
  return archived.length > 0;
}

// Brings an archived account back to the pickers. Returns whether one of the user's was restored.
export async function restoreAccount(
  db: Db,
  userId: string,
  input: { accountId: string },
): Promise<boolean> {
  const restored = await db
    .update(moneyAccounts)
    .set({ archivedAt: null })
    .where(
      and(
        eq(moneyAccounts.id, input.accountId),
        eq(moneyAccounts.userId, userId),
        isNotNull(moneyAccounts.archivedAt),
      ),
    )
    .returning({ id: moneyAccounts.id });
  return restored.length > 0;
}
