import { describe, expect, it } from "vitest";
import fixture from "../fixtures/scenarios.json";
import { findInjectionMarkers } from "../../src/lib/guard/injection-markers";

describe("prompt injection markers", () => {
  it.each(["P01", "P02", "P03", "P04"])("detects the hostile product text in %s", (id) => {
    const scenario = fixture.scenarios.find((item) => item.id === id);
    const firstItem = scenario?.cart?.lineItems[0];
    const description = firstItem && "description" in firstItem ? firstItem.description ?? "" : "";
    expect(findInjectionMarkers(description).length).toBeGreaterThan(0);
  });

  it.each([
    "Ream of 500 sheets, bright white",
    "Recycled A4 paper in a pack of 500 sheets.",
    "Ships in two days; tax included in the listed price.",
  ])("does not flag benign catalog text: %s", (text) => {
    expect(findInjectionMarkers(text)).toEqual([]);
  });
});
