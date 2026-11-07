import { describe, expect, it } from "vitest";
import { assertCents, centsToDecimalString, formatUsd } from "../src/lib/money";

describe("money helpers", () => {
  it.each([0, 1, 99, 100, 6000])("formats %i cents", (cents) => {
    expect(assertCents(cents)).toBe(cents);
    expect(centsToDecimalString(cents)).toBe(["0.00", "0.01", "0.99", "1.00", "60.00"][[0, 1, 99, 100, 6000].indexOf(cents)]);
  });

  it("formats USD for display", () => {
    expect(formatUsd(6000)).toBe("$60.00");
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid cents %s",
    (cents) => expect(() => assertCents(cents)).toThrow(RangeError),
  );
});
