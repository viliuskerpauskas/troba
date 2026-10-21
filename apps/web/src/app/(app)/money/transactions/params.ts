import { isMonth, type TransactionFilter } from "@troba/core";
import { z } from "zod";
import { categoryParam, parsePage } from "../params";

// The list's query parameters. The form can only send well-formed values, so a malformed one is
// an edited URL: it is left out rather than explained. Ids that aren't the user's match nothing,
// since every query filters by user.

export const searchMaxLength = 100;

export type ListQuery = Pick<TransactionFilter, "month" | "accountId" | "category" | "search"> & {
  page: number;
};

const querySchema = z.object({
  month: z.string().refine(isMonth).optional().catch(undefined),
  account: z.uuid().optional().catch(undefined),
  category: categoryParam.optional().catch(undefined),
  q: z
    .string()
    .transform((text) => text.slice(0, searchMaxLength).trim() || undefined)
    .optional()
    .catch(undefined),
});

export function parseListQuery(params: Record<string, unknown>): ListQuery {
  const { month, account, category, q } = querySchema.parse(params);
  const query: ListQuery = { page: parsePage(params.page) };
  if (month) query.month = month;
  if (account) query.accountId = account;
  if (category) query.category = category;
  if (q) query.search = q;
  return query;
}

// The list with the same filters, on another page.
export function transactionsHref(query: ListQuery): string {
  const params = new URLSearchParams();
  if (query.month) params.set("month", query.month);
  if (query.accountId) params.set("account", query.accountId);
  if (query.category) params.set("category", query.category);
  if (query.search) params.set("q", query.search);
  if (query.page > 1) params.set("page", String(query.page));
  const search = params.toString();
  return search ? `/money/transactions?${search}` : "/money/transactions";
}
