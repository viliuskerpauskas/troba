import { schema, type Db } from "@troba/db";
import { and, eq, gt, lt, or, sql } from "drizzle-orm";
import { isIPv6 } from "node:net";

// Sign-in rate limiting (SPEC-identity I3): at most 5 failed attempts per email and per IP address
// (an IPv6 /64) in any 15 minutes. Unknown emails count like known ones, so being refused says
// nothing about whether an account exists.

const { signInAttempts } = schema;

export const signInLimit = { attempts: 5, windowMinutes: 15 };

export type SignInAttempt = { id: string; email: string };

const windowStart = sql`now() - make_interval(mins => ${signInLimit.windowMinutes})`;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// What the limit counts an address by. An IPv6 client usually controls a whole /64, so it could
// otherwise rotate addresses to get past the limit: count the /64 prefix instead. An IPv4-mapped
// address (::ffff:a.b.c.d) is the IPv4 client, so it counts as that address. Anything that isn't
// an IPv6 address is counted as it is.
function networkKey(ipAddress: string): string {
  const address = ipAddress.split("%")[0]!;
  if (!isIPv6(address)) return ipAddress;
  const hextets = expandIPv6(address);
  if (hextets.slice(0, 6).join(":") === "0:0:0:0:0:ffff") {
    const [high, low] = hextets.slice(6).map((hextet) => parseInt(hextet, 16)) as [number, number];
    return [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
  }
  return `${hextets.slice(0, 4).join(":")}::/64`;
}

// The 8 hextets of a valid IPv6 address, as lowercase hex without leading zeros.
function expandIPv6(address: string): string[] {
  let text = address.toLowerCase();
  const ipv4 = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (ipv4) {
    const [a, b, c, d] = ipv4.slice(1).map(Number) as [number, number, number, number];
    text = `${text.slice(0, ipv4.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = text.split("::") as [string, string | undefined];
  const parts = (part: string) => (part ? part.split(":") : []);
  const hextets =
    tail === undefined
      ? parts(head)
      : [
          ...parts(head),
          ...Array<string>(8 - parts(head).length - parts(tail).length).fill("0"),
          ...parts(tail),
        ];
  return hextets.map((hextet) => parseInt(hextet, 16).toString(16));
}

// Call before checking the password. Returns null when the email or IP address is over the limit:
// refuse without checking the password. Otherwise the attempt counts as a failure until
// signInSucceeded clears it.
//
// The attempt is inserted before counting, so concurrent requests can't all slip under the limit:
// every request counts the attempts committed before it, and attempts let through are never
// removed, so at most 5 are let through. A refused attempt is removed again, so retrying while
// locked out doesn't push the lockout further back. This relies on each statement committing on
// its own: don't call it inside a transaction, which would hide the insert from other requests.
export async function beginSignInAttempt(
  db: Db,
  input: { email: string; ipAddress: string | null },
): Promise<SignInAttempt | null> {
  const email = normalizeEmail(input.email);
  const ipAddress = input.ipAddress === null ? null : networkKey(input.ipAddress);
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
