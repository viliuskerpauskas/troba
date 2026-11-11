import type { CategorizationModelClient } from "../money/ai-categories";
import { structuredResponse, type OpenAiConfig } from "./responses";

// The model client behind AI-suggested transaction categories (ADR-0016), used by the worker
// (ADR-0020). The request carries only what suggestCategories built: the user's category names and
// the masked merchant text. Nothing here logs it or the answer; see responses.ts for the transport.

export function createOpenAiCategorizationClient(
  config: OpenAiConfig,
  fetchImpl: typeof fetch = fetch,
): CategorizationModelClient {
  return {
    suggestCategories: ({ instructions, payload, schema, signal }) =>
      structuredResponse(config, fetchImpl, {
        instructions,
        input: JSON.stringify(payload),
        name: "transaction_categories",
        schema,
        signal,
      }),
  };
}
