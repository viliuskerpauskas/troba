import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mappingAnswerJsonSchema,
  proposeMapping,
  scrubCell,
  type MappingModelClient,
  type MappingModelRequest,
} from "./ai-mapping";

// Example Bank, unsigned amounts with a D/C marker. Every name, merchant and number is made up.
const ownIban = "DE89370400440532013000";
const counterpartyIban = "GB82WEST12345698765432";
const preamble = ["Statement for Anna Exampleton", `Account ${ownIban}`, "Period 2024-01"];
const header = ["Date", "Amount", "D/C", "Payee", "Details", "Card", "Account", "Ccy"];

type Fixture = { cells: string[] };

const dataRows: Fixture[] = [
  [
    "15.01.2024",
    "12,50",
    "D",
    "GROCERY MART",
    "Weekly shopping Maple Street",
    "4111 1111 1111 1111",
  ],
  ["16.01.2024", "1.234,00", "C", "Anna Exampleton", "Rent refund January", ""],
  ["17.01.2024", "3,20", "D", "COFFEE HUT", "Latte and croissant", "4111111111111111"],
  ["18.01.2024", "99,99", "D", "ELECTRIC CO", `Invoice 123456789012 ${counterpartyIban}`, ""],
  ["19.01.2024", "5,00", "D", "GROCERY MART", "Snacks", "4111 1111 1111 1111"],
  ["20.01.2024", "250,00", "C", "Bob Sample", "Birthday present", ""],
  ["21.01.2024", "8,75", "D", "COFFEE HUT", "Flat white", "4111 1111 1111 1111"],
  ["22.01.2024", "40,00", "D", "BOOK SHOP", "Novel purchase", "4111 1111 1111 1111"],
].map(([date, amount, dc, payee, details, card]) => ({
  cells: [date!, amount!, dc!, payee!, details!, card!, counterpartyIban, "EUR"],
}));

function csv(options: { rows?: Fixture[]; header?: string[] } = {}): Uint8Array {
  const lines = [
    ...preamble,
    (options.header ?? header).join(";"),
    ...(options.rows ?? dataRows).map((row) => row.cells.join(";")),
  ];
  return new TextEncoder().encode(lines.join("\n"));
}

// A model that maps the fixture correctly.
const goodAnswer = {
  decimalSeparator: ",",
  dateFormat: "DD.MM.YYYY",
  columns: {
    bookingDate: "Date",
    transactionDate: null,
    amount: "Amount",
    debitCredit: "D/C",
    currency: "Ccy",
    originalAmount: null,
    originalCurrency: null,
    counterparty: "Payee",
    counterpartyIban: "Account",
    description: "Details",
    transactionId: null,
    transactionType: null,
    ownIban: null,
  },
  debitValues: ["D"],
};

function fakeClient(answer: unknown): MappingModelClient & { requests: MappingModelRequest[] } {
  const requests: MappingModelRequest[] = [];
  return {
    requests,
    suggestMapping: (request) => {
      requests.push(request);
      return Promise.resolve(answer);
    },
  };
}

function failingClient(error: unknown): MappingModelClient {
  return { suggestMapping: () => Promise.reject(error) };
}

describe("proposeMapping", () => {
  afterEach(() => vi.restoreAllMocks());

  it("turns a valid answer into a proposal that reads the file", async () => {
    const client = fakeClient(goodAnswer);

    const proposal = await proposeMapping(csv(), { client });

    expect(proposal).not.toBeNull();
    expect(proposal!.profile).toMatchObject({
      skipLines: 3,
      delimiter: ";",
      encoding: "utf-8",
      decimalSeparator: ",",
      dateFormat: "DD.MM.YYYY",
      columns: { bookingDate: "Date", amount: "Amount", debitCredit: "D/C" },
      debitValues: ["D"],
    });
    // The nulls of the answer are absent fields, not columns named null.
    expect(proposal!.profile.columns).not.toHaveProperty("transactionDate");
    expect(proposal!.rows).toBe(dataRows.length);
    expect(proposal!.failed).toBe(0);
  });

  it("keeps a proposal that reads only some rows", async () => {
    const rows = [...dataRows, { cells: ["not a date", "1,00", "D", "X", "Y", "", "", "EUR"] }];

    const proposal = await proposeMapping(csv({ rows }), { client: fakeClient(goodAnswer) });

    expect(proposal).toMatchObject({ rows: dataRows.length, failed: 1 });
  });

  it("accepts a date format with a time part when the file's dates have one", async () => {
    const rows = dataRows.map(({ cells: [, ...rest] }, i) => ({
      cells: [`2024-01-${String(15 + i).padStart(2, "0")} 10:30:05`, ...rest],
    }));
    const client = fakeClient({ ...goodAnswer, dateFormat: "YYYY-MM-DD HH:mm:ss" });

    const proposal = await proposeMapping(csv({ rows }), { client });

    expect(proposal).toMatchObject({ rows: dataRows.length, failed: 0 });
    expect(proposal!.profile.dateFormat).toBe("YYYY-MM-DD HH:mm:ss");
    expect(client.requests[0]!.sample.rows[0]![0]).toBe("2024-01-15 10:30:05");
  });

  it("hands the client no IBAN, long digit run, free-text word or preamble line", async () => {
    const client = fakeClient(goodAnswer);

    await proposeMapping(csv(), { client });

    const payload = JSON.stringify(client.requests[0]!.sample);
    expect(payload).not.toMatch(/\d{9,}/);
    expect(payload).not.toContain(ownIban);
    expect(payload).not.toContain(counterpartyIban);
    expect(payload).not.toContain("4111");
    for (const word of [
      "GROCERY",
      "MART",
      "Anna",
      "Exampleton",
      "Bob",
      "Sample",
      "COFFEE",
      "HUT",
      "Maple",
      "Street",
      "Latte",
      "croissant",
      "Invoice",
      "Rent",
      "refund",
      "Birthday",
      "present",
      "Novel",
      "Statement",
      "Period",
      "Account ",
    ]) {
      expect(payload, word).not.toContain(word);
    }
  });

  it("sends the header row, at most five data rows and the coded values", async () => {
    const client = fakeClient(goodAnswer);

    await proposeMapping(csv(), { client });

    const { sample } = client.requests[0]!;
    expect(sample.headers).toEqual(header);
    expect(sample.rows).toHaveLength(5);
    expect(sample.rows.every((row) => row.length === header.length)).toBe(true);
    // The debit/credit marker and the currency are coded; the payee column repeats its words but
    // is not a single short token, so it stays masked.
    expect(sample.codedValues).toContainEqual({ header: "D/C", values: ["D", "C"] });
    expect(sample.codedValues).toContainEqual({ header: "Ccy", values: ["EUR"] });
    expect(sample.codedValues.map((column) => column.header)).not.toContain("Payee");
    // Dates and amounts stay readable, so the model can tell the format and the separator.
    expect(sample.rows.some((row) => row[0] === "15.01.2024")).toBe(true);
    expect(sample.rows.some((row) => row[1] === "1.234,00")).toBe(true);
  });

  describe("coded values", () => {
    // A long file whose Payee column repeats a few single words, as a person's statement does.
    function repeated(values: string[], count = 40): Fixture[] {
      return Array.from({ length: count }, (_, i) => ({
        cells: [
          `${String((i % 28) + 1).padStart(2, "0")}.01.2024`,
          "10,00",
          i % 3 === 0 ? "C" : "D",
          values[i % values.length]!,
          "Details",
          "",
          counterpartyIban,
          "EUR",
        ],
      }));
    }

    it.each([
      ["a few merchants", ["Netflix", "Spotify", "Rent"]],
      ["a few first names", ["Anna", "Bob", "Carol"]],
      ["one merchant in capitals", ["NETFLIX", "SPOTIFY"]],
      ["a single repeated word", ["Rent"]],
    ])(
      "sends no word from a column of %s, neither as coded values nor in the sample",
      async (_name, values) => {
        const client = fakeClient(goodAnswer);

        await proposeMapping(csv({ rows: repeated(values) }), { client });

        const { sample } = client.requests[0]!;
        expect(sample.codedValues.map((column) => column.header)).not.toContain("Payee");
        const payload = JSON.stringify(sample);
        for (const value of values) expect(payload, value).not.toContain(value);
      },
    );

    it("still sends the debit/credit markers and currencies of a realistic file", async () => {
      const client = fakeClient(goodAnswer);

      await proposeMapping(csv({ rows: repeated(["Netflix", "Spotify"]) }), { client });

      const { sample } = client.requests[0]!;
      expect(sample.codedValues).toContainEqual({ header: "D/C", values: ["C", "D"] });
      expect(sample.codedValues).toContainEqual({ header: "Ccy", values: ["EUR"] });
    });

    it("sends a column of several currencies as coded values", async () => {
      const currencies = ["EUR", "USD", "GBP"];
      const rows = repeated(["Netflix"]).map(({ cells }, i) => ({
        cells: cells.map((cell, column) => (column === 7 ? currencies[i % 3]! : cell)),
      }));
      const client = fakeClient(goodAnswer);

      await proposeMapping(csv({ rows }), { client });

      expect(client.requests[0]!.sample.codedValues).toContainEqual({
        header: "Ccy",
        values: currencies,
      });
    });

    it.each([
      // A column of nothing but currency codes is a currency column as far as content can tell.
      ["currency-code words among other text", ["TOP", "Weekly shop", "PEN"]],
      ["currency-code words and markers", ["TOP", "CR", "ALL"]],
    ])(
      "masks a description column of %s, in the sample and the coded values",
      async (_name, values) => {
        const rows = repeated(["Netflix"]).map(({ cells }, i) => ({
          cells: cells.map((cell, column) => (column === 4 ? values[i % values.length]! : cell)),
        }));
        const client = fakeClient(goodAnswer);

        await proposeMapping(csv({ rows }), { client });

        const { sample } = client.requests[0]!;
        expect(sample.codedValues.map((column) => column.header)).not.toContain("Details");
        expect(sample.rows.map((row) => row[4])).not.toContain("TOP");
        const payload = JSON.stringify(sample);
        for (const word of ["ALL", "TOP", "PEN", "Weekly"]) {
          expect(payload, word).not.toContain(word);
        }
      },
    );

    it.each([
      ["DEBIT/CREDIT", ["DEBIT", "CREDIT"]],
      ["Debit/Credit", ["Debit", "Credit"]],
      ["DBIT/CRDT", ["DBIT", "CRDT"]],
      ["DR/CR", ["DR", "CR"]],
    ])("sends %s markers as coded values", async (_name, [out, into]) => {
      const rows = repeated(["Netflix"]).map(({ cells }, i) => ({
        cells: cells.map((cell, column) => (column === 2 ? (i % 2 ? into! : out!) : cell)),
      }));
      const client = fakeClient({ ...goodAnswer, debitValues: [out!] });

      const proposal = await proposeMapping(csv({ rows }), { client });

      expect(client.requests[0]!.sample.codedValues).toContainEqual({
        header: "D/C",
        values: [out, into],
      });
      expect(proposal).not.toBeNull();
    });
  });

  describe("header cells", () => {
    // A data row taken for the header: a file with no header line, or read with the wrong skip.
    const words = ["TEA HOUSE", "Green tea Elm Road"];

    it.each([
      ["a date", "14.01.2024"],
      ["an amount", "250"],
      ["a signed amount", "-7.30"],
      ["an IBAN", "DE89 3704 0044 0532 0130 00"],
      ["a date inside text", "Paid 14.01.2024 at till"],
      ["an IBAN inside text", "From DE89 3704 0044 0532 0130 00"],
      ["a long digit run", "123456789"],
      ["an account number", "98765432"],
    ])("sends nothing when the header row holds %s, as a data row does", async (_name, cell) => {
      const client = fakeClient(goodAnswer);
      const wrongGuess = ["Date", "Amount", "D/C", ...words, cell, "Account", "Ccy"];

      expect(await proposeMapping(csv({ header: wrongGuess }), { client })).toBeNull();
      expect(client.requests).toHaveLength(0);
    });

    it("sends nothing for a file with no header line, whose first data row is taken for it", async () => {
      const client = fakeClient(goodAnswer);
      const bytes = new TextEncoder().encode(dataRows.map((row) => row.cells.join(";")).join("\n"));

      expect(await proposeMapping(bytes, { client })).toBeNull();
      expect(client.requests).toHaveLength(0);
    });

    it("keeps ordinary headers as they are", async () => {
      const client = fakeClient(goodAnswer);

      await proposeMapping(csv(), { client });

      expect(client.requests[0]!.sample.headers).toEqual(header);
    });
  });

  it("asks for the profile's fields in a strict JSON schema, with instructions", async () => {
    const client = fakeClient(goodAnswer);

    await proposeMapping(csv(), { client });

    const request = client.requests[0]!;
    expect(request.schema).toEqual(mappingAnswerJsonSchema);
    expect(request.instructions.length).toBeGreaterThan(100);
    expect(request.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    ["a header that is not in the file", { columns: { ...goodAnswer.columns, amount: "Total" } }],
    ["a date format the profile does not support", { dateFormat: "YY-MM-DD" }],
    ["a debit/credit column without debit values", { debitValues: null }],
    ["a missing required field", { decimalSeparator: undefined }],
    ["a date format that reads no row", { dateFormat: "YYYY-MM-DD" }],
  ])("discards an answer with %s", async (_name, patch) => {
    const proposal = await proposeMapping(csv(), {
      client: fakeClient({ ...goodAnswer, ...patch }),
    });

    expect(proposal).toBeNull();
  });

  it.each([
    ["is not an object", "mapping: amount"],
    ["is null", null],
    ["is an array", []],
  ])("discards an answer that %s", async (_name, answer) => {
    expect(await proposeMapping(csv(), { client: fakeClient(answer) })).toBeNull();
  });

  it("returns none when the client throws, without throwing", async () => {
    const proposal = await proposeMapping(csv(), {
      client: failingClient(new Error("HTTP 500")),
    });

    expect(proposal).toBeNull();
  });

  it("returns none when the client throws something that is not an error", async () => {
    expect(await proposeMapping(csv(), { client: failingClient("boom") })).toBeNull();
  });

  it("returns none when the client does not answer in time, and aborts it", async () => {
    let signal: AbortSignal | undefined;
    const client: MappingModelClient = {
      suggestMapping: (request) => {
        signal = request.signal;
        return new Promise(() => {});
      },
    };

    const proposal = await proposeMapping(csv(), { client, timeoutMs: 20 });

    expect(proposal).toBeNull();
    expect(signal?.aborted).toBe(true);
  });

  it("makes exactly one attempt", async () => {
    const suggestMapping = vi.fn().mockRejectedValue(new Error("HTTP 429"));

    await proposeMapping(csv(), { client: { suggestMapping } });

    expect(suggestMapping).toHaveBeenCalledTimes(1);
  });

  it("never calls a client when none is configured", async () => {
    expect(await proposeMapping(csv(), { client: null })).toBeNull();
  });

  it("builds no payload for a file it cannot read as a table", async () => {
    const client = fakeClient(goodAnswer);
    // Latin-1 bytes are not UTF-8: the file is refused, not guessed at.
    const bytes = Uint8Array.from([0x44, 0x61, 0x74, 0x65, 0x3b, 0xe9, 0x0a, 0x31, 0x3b, 0xe9]);

    expect(await proposeMapping(bytes, { client })).toBeNull();
    expect(await proposeMapping(new Uint8Array(), { client })).toBeNull();
    expect(client.requests).toHaveLength(0);
  });

  it("uses the read settings it is given", async () => {
    const client = fakeClient(goodAnswer);
    const bytes = csv();

    const proposal = await proposeMapping(bytes, {
      client,
      read: { skipLines: 3, delimiter: ";", encoding: "windows-1252" },
    });

    expect(proposal?.profile).toMatchObject({
      skipLines: 3,
      delimiter: ";",
      encoding: "windows-1252",
    });
  });

  it("logs neither the payload nor the answer on any path", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {}),
    );

    await proposeMapping(csv(), { client: fakeClient(goodAnswer) });
    await proposeMapping(csv(), { client: fakeClient({ ...goodAnswer, dateFormat: "nonsense" }) });
    await proposeMapping(csv(), { client: failingClient(new Error("Weekly shopping")) });
    await proposeMapping(csv(), { client: null });

    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});

describe("scrubCell", () => {
  it.each([
    ["an IBAN", "DE89370400440532013000"],
    ["a spaced IBAN", "GB82 WEST 1234 5698 7654 32"],
    ["a card number", "4111 1111 1111 1111"],
    ["a dashed card number", "4111-1111-1111-1111"],
    ["a long reference", "20240115103000"],
    ["a phone number", "+370 600 00000"],
    ["an 8-digit account number", "12345678"],
    ["a 7-digit reference", "1234567"],
    ["a spaced 8-digit number", "1234 5678"],
  ])("masks %s", (_name, cell) => {
    const scrubbed = scrubCell(cell);

    expect(scrubbed).not.toMatch(/\d{4}/);
    expect(scrubbed).toMatch(/^\[.+\]$/);
  });

  it.each([
    ["an ISO date", "2024-01-15"],
    ["a day-first date", "15.01.2024"],
    ["a US date", "01/15/2024"],
    ["a timestamp", "2024-01-15 10:30:05"],
    ["a plain amount", "12.50"],
    ["a signed amount", "-12,50"],
    ["an amount with thousands separators", "1.234,00"],
    ["an amount with a space separator", "1 234,56"],
    ["an integer", "250"],
    ["a four-digit amount", "1234.56"],
    ["a six-digit amount", "123456"],
    ["a large formatted amount", "1,234,567.89"],
    ["an empty cell", ""],
  ])("keeps %s", (_name, cell) => {
    expect(scrubCell(cell)).toBe(cell);
  });

  it("replaces free text by a shape with the same length and character classes", () => {
    expect(scrubCell("GROCERY MART")).toBe("AAAAAAA AAAA");
    expect(scrubCell("Anna O'Brien")).toBe("Aaaa A'Aaaaa");
    expect(scrubCell("Invoice 123456789012")).toBe("Aaaaaaa ############");
    expect(scrubCell("Café Łódź")).toBe("Aaaa Aaaa");
  });

  it("does not take a three-letter word for a currency", () => {
    expect(scrubCell("ATM")).toBe("AAA");
    expect(scrubCell("FEE")).toBe("AAA");
  });

  it("masks a currency-code-shaped word, which only a coded column sends as it is", () => {
    expect(scrubCell("TOP")).toBe("AAA");
    expect(scrubCell("ALL")).toBe("AAA");
    expect(scrubCell("EUR")).toBe("AAA");
  });

  it("bounds the length of a shape", () => {
    expect(scrubCell("a".repeat(500)).length).toBeLessThanOrEqual(60);
  });
});

describe("mappingAnswerJsonSchema", () => {
  type ObjectSchema = {
    type: string;
    properties: Record<string, ObjectSchema>;
    required: string[];
    additionalProperties: boolean;
  };
  const schema = mappingAnswerJsonSchema as unknown as ObjectSchema;

  it("is a strict object schema OpenAI structured output accepts", () => {
    expect(schema).not.toHaveProperty("$schema");
    for (const object of [schema, schema.properties.columns!]) {
      expect(object.type).toBe("object");
      expect(object.additionalProperties).toBe(false);
      // Strict mode wants every key listed as required.
      expect(object.required.toSorted()).toEqual(Object.keys(object.properties).toSorted());
    }
  });

  it("covers every field of the profile and no other", () => {
    expect(Object.keys(schema.properties.columns!.properties).toSorted()).toEqual(
      Object.keys(goodAnswer.columns).toSorted(),
    );
    expect(Object.keys(schema.properties).toSorted()).toEqual(Object.keys(goodAnswer).toSorted());
  });
});
