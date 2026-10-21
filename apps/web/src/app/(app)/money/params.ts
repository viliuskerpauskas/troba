import { z } from "zod";

// Query parameters shared by the money pages that list transactions.

// 1 to 99999: far beyond any user's transactions at a hundred a page.
const pageSchema = z
  .string()
  .regex(/^[1-9]\d{0,4}$/)
  .transform(Number);

export function parsePage(value: unknown): number {
  const page = pageSchema.safeParse(value);
  return page.success ? page.data : 1;
}

// A category id, or the uncategorized transactions.
export const categoryParam = z.union([z.literal("uncategorized"), z.uuid()]);
