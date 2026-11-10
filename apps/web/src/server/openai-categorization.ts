import type { CategorizationModelClient } from "@troba/core";
import { openAiConfig, type OpenAiConfig } from "./env";
import { structuredResponse } from "@troba/core";

// The model client behind AI-suggested transaction categories (ADR-0016). The request carries only
// what core's suggestCategories built: the user's category names and the masked merchant text.
// Nothing here logs it or the answer; see packages/core/src/openai/responses.ts for the transport.

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

// The client for this server's configuration, or null with no key: then nothing is ever sent.
export function categorizationModelClient(): CategorizationModelClient | null {
  const config = openAiConfig();
  return config && createOpenAiCategorizationClient(config);
}
