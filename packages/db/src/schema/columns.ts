import { sql } from "drizzle-orm";
import { timestamp, uuid } from "drizzle-orm/pg-core";

// Columns every module's tables share.

export const id = () =>
  uuid("id")
    .default(sql`gen_random_uuid()`)
    .primaryKey();
export const timestamptz = (name: string) => timestamp(name, { withTimezone: true });
export const createdAt = () => timestamptz("created_at").defaultNow().notNull();
export const updatedAt = () =>
  timestamptz("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull();
