import { schema, type Db } from "@troba/db";
import { lt, sql } from "drizzle-orm";

// Expired sessions, with the IP address and user agent they keep (see the sessions table), are
// personal data with no use left. Better Auth deletes one only when its browser comes back, so
// this deletes every user's: the auth hooks call it on each sign-in and daily session refresh.

const { sessions } = schema;

export async function deleteExpiredSessions(db: Db): Promise<void> {
  await db.delete(sessions).where(lt(sessions.expiresAt, sql`now()`));
}
