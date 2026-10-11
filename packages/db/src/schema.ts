// Tables are added per module (identity, money). Each user-owned table carries user_id.
export {};

// Temporary: proves a schema change without a migration turns CI red. Reverted next.
import { pgTable, text } from "drizzle-orm/pg-core";
export const driftProbe = pgTable("drift_probe", { id: text().primaryKey() });
