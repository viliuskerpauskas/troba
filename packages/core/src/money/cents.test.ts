import { describe, expect, it } from "vitest";
import { centsToDecimal, parseCents, parseTypedCents } from "./cents";

describe("parseCents", () => {
  it.each([
    ["12", 1200n],
    ["12.5", 1250n],
    ["12.50", 1250n],
    ["0.07", 7n],
    [".5", 50n],
    ["  3.10 ", 310n],
    ["-4.20", -420n],
    ["+4.20", 420n],
    ["1,234.56", 123456n],
    ["1 234.56", 123456n],
    ["12,345,678.90", 1234567890n],
    ["0", 0n],
    // Past Number.MAX_SAFE_INTEGER, where a float would lose the last cent.
    ["90071992547409.93", 9007199254740993n],
  ])("reads %j as %s cents", (text, cents) => {
    expect(parseCents(text)).toBe(cents);
  });

  it.each([
    ["1.234,56", 123456n],
    ["12,5", 1250n],
    ["-0,99", -99n],
    ["1 234,56", 123456n],
  ])("reads %j with a decimal comma as %s cents", (text, cents) => {
    expect(parseCents(text, { decimalSeparator: "," })).toBe(cents);
  });

  it.each([
    "",
    "  ",
    "abc",
    "12.345", // a third decimal would have to be rounded
    "1.2.3",
    "12.",
    "-",
    "--1",
    "1e3",
    "0x10",
    "Infinity",
    "NaN",
    "1,23.45", // a malformed thousands group
    "1234,567.00",
    ",123.00",
    "12,5", // with a decimal point, the comma only groups thousands
    "€12",
    "12 EUR",
    "1".repeat(16),
  ])("refuses %j", (text) => {
    expect(parseCents(text)).toBeNull();
  });

  it("refuses a point as the decimal when the separator is a comma", () => {
    expect(parseCents("12.50", { decimalSeparator: "," })).toBeNull();
  });
});

describe("parseTypedCents", () => {
  it.each([
    ["12.50", 1250n],
    ["12,50", 1250n],
    ["0,5", 50n],
    ["1,234.56", 123456n],
    ["1 234,56", 123456n],
  ])("reads %j as %s cents", (text, cents) => {
    expect(parseTypedCents(text)).toBe(cents);
  });

  it.each([
    "12.345", // not 12,345.00: a point is always the decimal
    "1.234,56",
    "1,234", // a thousand, or one and a bit
    "12,345",
  ])("refuses %j rather than guess", (text) => {
    expect(parseTypedCents(text)).toBeNull();
  });
});

describe("centsToDecimal", () => {
  it.each([
    [1250n, "12.50"],
    [7n, "0.07"],
    [0n, "0.00"],
    [-420n, "-4.20"],
    [-5n, "-0.05"],
    [9007199254740993n, "90071992547409.93"],
  ])("writes %s cents as %j", (cents, text) => {
    expect(centsToDecimal(cents)).toBe(text);
  });
});
