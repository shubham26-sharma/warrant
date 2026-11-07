import type { Verdict } from "../schemas/decision";

const SEVERITY: Record<Verdict, number> = {
  APPROVE: 0,
  REVIEW: 1,
  BLOCK: 2,
};

export function maxVerdict(left: Verdict, right: Verdict): Verdict {
  return SEVERITY[left] >= SEVERITY[right] ? left : right;
}

export function combine(deterministic: Verdict, ai: Verdict): Verdict {
  return maxVerdict(deterministic, ai);
}
