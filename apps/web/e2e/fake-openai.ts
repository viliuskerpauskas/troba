// Preloaded into the E2E server (`node --import`, see playwright.config.ts): stands in for OpenAI at
// the server's outbound boundary, so the real model client runs and nothing leaves the machine.
// The server's fetch answers a mapping request for the one unknown format the import test uploads,
// and a categorization request for GROCERY MART, with the answer a model would give (and refuses
// one that carries what must not be sent), and fails every other request like an unreachable
// service.
// The key it is run with is made up.
const endpoint = "https://api.openai.com/v1/responses";

// Fictional: the headers of the file in e2e/money-import.spec.ts that the "model" knows how to map.
const knownHeaders = ["Booked", "Sum", "Who", "Note"];
const knownAnswer = {
  decimalSeparator: ",",
  dateFormat: "YYYY-MM-DD",
  columns: {
    bookingDate: "Booked",
    transactionDate: null,
    amount: "Sum",
    debitCredit: null,
    currency: null,
    originalAmount: null,
    originalCurrency: null,
    counterparty: "Who",
    counterpartyIban: null,
    description: "Note",
    transactionId: null,
    transactionType: null,
    ownIban: null,
  },
  debitValues: null,
};

// What must never reach the provider (ADR-0016), checked on the merchants of every categorization
// request: the fictional own name of the user in e2e/money-ai-categories.spec.ts, IBAN-shaped
// values, long digit runs, amounts and dates, and the text of the fixture's direct transfers. A
// request that breaks one gets a 400 and no answer, so the suggestions the spec waits for never
// appear.
const forbidden: RegExp[] = [
  /jordan|quinn/i,
  /\b[A-Z]{2}\d{2} ?[A-Z0-9]{4}[ A-Z0-9]{7,}\b/i,
  /\d{7,}/,
  /\d+[.,]\d{2}\b/,
  /\b\d{4}-\d{2}-\d{2}\b/,
  /EXAMPLE LANDLORD|Savings round-up|EXAMPLE CLIENT|EXAMPLE EMPLOYER/i,
];

// Answers a categorization request the way a model would for the one merchant it knows: GROCERY
// MART is Food, anything else "none".
function categorize(input: string): Response {
  const payload = JSON.parse(input) as {
    categories: { id: string; name: string }[];
    merchants: { id: string; counterparty: string | null }[];
  };
  const sent = JSON.stringify(payload.merchants);
  if (forbidden.some((pattern) => pattern.test(sent))) return new Response("{}", { status: 400 });
  const food = payload.categories.find((category) => category.name === "Food");
  const answers = payload.merchants.map((merchant) => ({
    merchant: merchant.id,
    category: merchant.counterparty === "GROCERY MART" && food ? food.id : "none",
  }));
  return Response.json({
    status: "completed",
    output: [
      { type: "message", content: [{ type: "output_text", text: JSON.stringify({ answers }) }] },
    ],
  });
}

const realFetch = globalThis.fetch;

globalThis.fetch = async (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  if (url !== endpoint) return realFetch(input, init);

  const body = JSON.parse(String(init?.body)) as {
    input: string;
    text: { format: { name: string } };
  };
  if (body.text.format.name === "transaction_categories") return categorize(body.input);
  const sample = JSON.parse(body.input) as { headers: string[] };
  if (JSON.stringify(sample.headers) !== JSON.stringify(knownHeaders)) {
    return new Response("{}", { status: 503 });
  }
  return Response.json({
    status: "completed",
    output: [
      { type: "message", content: [{ type: "output_text", text: JSON.stringify(knownAnswer) }] },
    ],
  });
};
