import { monthOf, monthPattern } from "@troba/core";
import { z } from "zod";

// The report's query parameters. A missing or malformed month is the current one: the picker
// can't send anything else, so a bad value is an edited URL, not a mistake to explain.

export const sortKeys = ["amount", "share", "count"] as const;
export type SortKey = (typeof sortKeys)[number];
export type SortDirection = "asc" | "desc";

const monthSchema = z.string().regex(monthPattern);

export function parseMonth(value: unknown): string {
  const month = monthSchema.safeParse(value);
  return month.success ? month.data : monthOf(new Date());
}

const sortSchema = z.object({
  sort: z.enum(sortKeys).catch("amount"),
  dir: z.enum(["asc", "desc"]).catch("desc"),
});

export function parseSort(params: Record<string, unknown>): { sort: SortKey; dir: SortDirection } {
  return sortSchema.parse({ sort: params.sort, dir: params.dir });
}

// A category id, or the uncategorized transactions.
export const categoryParam = z.union([z.literal("uncategorized"), z.uuid()]);
