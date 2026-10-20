import { ensureMoneyDefaults } from "@troba/core";
import { db } from "./db";
import { requireUser, type SessionUser } from "./session";

// Call first in every money page, in place of requireUser(): a user's first visit to money seeds
// their Cash account and default categories (SPEC-money M1). Each page calls it, not a layout, so
// the defaults exist before the page's own queries run.
export async function requireMoneyUser(): Promise<SessionUser> {
  const user = await requireUser();
  await ensureMoneyDefaults(db(), user.userId);
  return user;
}
