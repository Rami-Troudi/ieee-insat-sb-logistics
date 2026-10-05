import { describe, expect, it } from "vitest";
import { readSelection, storeSelection } from "../lib/selection-storage";
describe("selection storage", () => {
  it.each(["null", "[]", "3", '"text"', "invalid"])("rejects invalid stored shape %s", (value) => {
    expect(readSelection({ getItem: () => value })).toEqual({});
  });
  it("keeps only positive bounded integer quantities", () => {
    expect(
      readSelection({
        getItem: () =>
          JSON.stringify({ valid: 2, zero: 0, negative: -1, fraction: 1.5, text: "2", huge: 101 }),
      })
    ).toEqual({ valid: 2 });
  });
  it("handles blocked reads and quota failures", () => {
    expect(
      readSelection({
        getItem: () => {
          throw new Error("blocked");
        },
      })
    ).toEqual({});
    expect(() =>
      storeSelection(
        {
          setItem: () => {
            throw new Error("quota");
          },
        },
        { valid: 1 }
      )
    ).not.toThrow();
  });
});
