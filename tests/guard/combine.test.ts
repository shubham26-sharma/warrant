import { describe, expect, it } from "vitest";
import { combine, maxVerdict } from "../../src/lib/guard/combine";
import type { Verdict } from "../../src/lib/schemas/decision";

const verdicts: Verdict[] = ["APPROVE", "REVIEW", "BLOCK"];
const severity: Record<Verdict, number> = { APPROVE: 0, REVIEW: 1, BLOCK: 2 };

describe("verdict combination", () => {
  it.each(verdicts.flatMap((left) => verdicts.map((right) => [left, right] as const)))(
    "returns at least the severity of %s and %s",
    (left, right) => {
      const combined = combine(left, right);
      expect(severity[combined]).toBeGreaterThanOrEqual(severity[left]);
      expect(severity[combined]).toBeGreaterThanOrEqual(severity[right]);
      expect(maxVerdict(left, right)).toBe(combined);
    },
  );

  it.each(verdicts)("keeps deterministic BLOCK as BLOCK when AI says %s", (ai) => {
    expect(combine("BLOCK", ai)).toBe("BLOCK");
  });
});
