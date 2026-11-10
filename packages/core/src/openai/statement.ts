import { defaultStatementTimeoutMs, type StatementModelClient } from "../money/import/pdf-import";
import { structuredResponse, type OpenAiConfig } from "./responses";

// The model client behind PDF import (ADR-0018): the whole PDF goes to OpenAI as a file input with
// a strict JSON schema, asking it not to store the request. One attempt, bounded by the reader's
// timeout and the transport's own; see responses.ts for what is and isn't logged.

export function createOpenAiStatementClient(
  config: OpenAiConfig,
  fetchImpl: typeof fetch = fetch,
): StatementModelClient {
  return {
    readStatement: ({ instructions, pdf, schema, signal }) =>
      structuredResponse(config, fetchImpl, {
        instructions,
        // Not the client's filename, which is the user's own text.
        input: { file: { filename: "statement.pdf", mime: "application/pdf", bytes: pdf } },
        name: "bank_statement",
        schema,
        signal,
        timeoutMs: defaultStatementTimeoutMs,
      }),
  };
}
