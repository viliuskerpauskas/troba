import type { MappingModelClient } from "@troba/core";
import { openAiConfig, type OpenAiConfig } from "./env";
import { structuredResponse } from "@troba/core";

// The model client behind AI-suggested import mappings (ADR-0015). The request carries only what
// core's proposeMapping built, the scrubbed sample; see packages/core/src/openai/responses.ts for the transport.

export function createOpenAiMappingClient(
  config: OpenAiConfig,
  fetchImpl: typeof fetch = fetch,
): MappingModelClient {
  return {
    suggestMapping: ({ instructions, sample, schema, signal }) =>
      structuredResponse(config, fetchImpl, {
        instructions,
        input: JSON.stringify(sample),
        name: "import_mapping",
        schema,
        signal,
      }),
  };
}

// The client for this server's configuration, or null with no key: then nothing is ever sent.
export function mappingModelClient(): MappingModelClient | null {
  const config = openAiConfig();
  return config && createOpenAiMappingClient(config);
}
