import { schema, type Db } from "@troba/db";
import { and, eq, gt, lt, or, sql } from "drizzle-orm";

// Sign-in rate limiting (SPEC-identity I3): at most 5 failed attempts per email and per IP address
// in any 15 minutes. Unknown emails count like known ones, so being refused says nothing about
// whether an account exists.

const { signInAttempts } = schema;

export const signInLimit = { attempts: 5, windowMinutes: 15 };

export type SignInAttempt = { id: string; email: string };

const windowStart = sql`now() - make_interval(mins => ${signInLimit.windowMinutes})`;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// Call before checking the password. Returns null when the email or IP address is over the limit:
// refuse without checking the password. Otherwise the attempt counts as a failure until
// signInSucceeded clears it.
//
// The attempt is inserted before counting, so concurrent requests can't all slip under the limit:
// every request counts the attempts committed before it, and attempts let through are never
// removed, so at most 5 are let through. A refused attempt is removed again, so retrying while
// locked out doesn't push the lockout further back.
export async function beginSignInAttempt(
  db: Db,
  input: { email: string; ipAddress: string | null },
): Promise<SignInAttempt | null> {
  const email = normalizeEmail(input.email);
  const { ipAddress } = input;
  await db.delete(signInAttempts).where(lt(signInAttempts.createdAt, windowStart));
  const [attempt] = await db
    .insert(signInAttempts)
    .values({ email, ipAddress })
    .returning({ id: signInAttempts.id });

  const [counts] = await db
    .select({
      email: sql<number>`count(*) filter (where ${signInAttempts.email} = ${email})::int`,
      ipAddress: sql<number>`count(*) filter (where ${signInAttempts.ipAddress} = ${ipAddress})::int`,
    })
    .from(signInAttempts)
    .where(
      and(
        gt(signInAttempts.createdAt, windowStart),
        ipAddress === null
          ? eq(signInAttempts.email, email)
          : or(eq(signInAttempts.email, email), eq(signInAttempts.ipAddress, ipAddress)),
      ),
    );
  if (counts!.email > signInLimit.attempts || counts!.ipAddress > signInLimit.attempts) {
    await db.delete(signInAttempts).where(eq(signInAttempts.id, attempt!.id));
    return null;
  }
  return { id: attempt!.id, email };
}

// Clears the email's failures, and this attempt from its IP address's count. Other emails'
// failures from the same address stay: signing in to one account mustn't reset guessing at others.
export async function signInSucceeded(db: Db, attempt: SignInAttempt): Promise<void> {
  await db
    .delete(signInAttempts)
    .where(or(eq(signInAttempts.id, attempt.id), eq(signInAttempts.email, attempt.email)));
}
