import { describe, expect, it } from "vitest";
import { readCategoryAnswer } from "./ai-categories";

const merchantIds = new Set(["m1", "m2", "m3"]);
const categoryIds = new Set(["cat-food", "cat-bills"]);

function read(answer: unknown) {
  return readCategoryAnswer(answer, merchantIds, categoryIds);
}

describe("readCategoryAnswer", () => {
  it("takes a category id of the user's, or none, per merchant", () => {
    const answer = {
      answers: [
        { merchant: "m1", category: "cat-food" },
        { merchant: "m2", category: "none" },
      ],
    };

    expect(read(answer)).toEqual(
      new Map([
        ["m1", "cat-food"],
        ["m2", null],
      ]),
    );
  });

  it("discards an unknown or foreign category id for that merchant only", () => {
    const answer = {
      answers: [
        { merchant: "m1", category: "cat-from-another-user" },
        { merchant: "m2", category: "cat-bills" },
        { merchant: "m3", category: "" },
      ],
    };

    expect(read(answer)).toEqual(new Map([["m2", "cat-bills"]]));
  });

  it("discards a merchant that was not asked about, and a repeated one", () => {
    const answer = {
      answers: [
        { merchant: "m9", category: "cat-food" },
        { merchant: "m1", category: "cat-food" },
        { merchant: "m1", category: "cat-bills" },
      ],
    };

    expect(read(answer)).toEqual(new Map());
  });

  it("discards malformed entries and keeps the sound ones", () => {
    const answer = {
      answers: [
        null,
        "m1",
        { merchant: "m1" },
        { merchant: 2, category: "cat-food" },
        { merchant: "m2", category: ["cat-food"] },
        { merchant: "m3", category: "cat-food" },
      ],
    };

    expect(read(answer)).toEqual(new Map([["m3", "cat-food"]]));
  });

  it.each([null, undefined, "cat-food", 3, [], {}, { answers: "m1" }, { answers: {} }])(
    "reads nothing usable from the answer %j",
    (answer) => {
      expect(read(answer)).toBeNull();
    },
  );

  it("reads an empty list of answers as no merchant answered", () => {
    expect(read({ answers: [] })).toEqual(new Map());
  });
});
