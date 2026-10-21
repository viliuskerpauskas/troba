import { isMonth, monthOf, reportSortKeys } from "@troba/core";
import { z } from "zod";

// The report's query parameters. A missing or malformed month is the current one: the picker
// can't send anything else, so a bad value is an edited URL, not a mistake to explain.

const monthSchema = z.string().refine(isMonth);

export function parseReportMonth(value: unknown): string {
  const month = monthSchema.safeParse(value);
  return month.success ? month.data : monthOf(new Date());
}

const sortSchema = z.object({
  sort: z.enum(reportSortKeys).catch("amount"),
  dir: z.enum(["asc", "desc"]).catch("desc"),
});

export function parseSort(params: Record<string, unknown>) {
  return sortSchema.parse({ sort: params.sort, dir: params.dir });
}
