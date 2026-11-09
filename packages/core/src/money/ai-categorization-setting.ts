import { schema, type Db } from "@troba/db";
import { eq } from "drizzle-orm";

// The user's own switch for AI-suggested transaction categories (ADR-0016). It lives on the user
// row, so it goes with the account when it is deleted. Default on: whether anything is sent at all
// also depends on the server having an OpenAI key, which is the web app's to know.

const { users } = schema;

// False for a user who turned it off; also false for an id that is no user, so nothing is sent
// for one.
export async function aiCategorizationEnabledFor(db: Db, userId: string): Promise<boolean> {
  const [user] = await db
    .select({ enabled: users.aiCategorization })
    .from(users)
    .where(eq(users.id, userId));
  return user?.enabled ?? false;
}

export async function setAiCategorization(db: Db, userId: string, enabled: boolean): Promise<void> {
  await db.update(users).set({ aiCategorization: enabled }).where(eq(users.id, userId));
}
