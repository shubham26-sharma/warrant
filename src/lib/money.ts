export function assertCents(cents: number): number {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new RangeError("Cents must be a non-negative safe integer");
  }

  return cents;
}

export function centsToDecimalString(cents: number): string {
  assertCents(cents);
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

export function formatUsd(cents: number): string {
  assertCents(cents);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}
