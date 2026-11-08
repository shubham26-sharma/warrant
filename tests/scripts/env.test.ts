import { afterEach, describe, expect, it, vi } from "vitest";
import { requireEnvironmentVariables } from "../../scripts/env";

describe("script environment validation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("lists missing variable names without printing any values", () => {
    vi.stubEnv("SCRIPT_TEST_SECRET", "");
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(requireEnvironmentVariables(["SCRIPT_TEST_SECRET"])).toBe(false);
    expect(error).toHaveBeenNthCalledWith(1, "Missing required environment variable(s): SCRIPT_TEST_SECRET.");
    expect(error).toHaveBeenNthCalledWith(2, "Set them in .env.local or in the current process environment.");
  });

  it("accepts present values without logging them", () => {
    vi.stubEnv("SCRIPT_TEST_PRESENT", "private-test-value");
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(requireEnvironmentVariables(["SCRIPT_TEST_PRESENT"])).toBe(true);
    expect(error).not.toHaveBeenCalled();
  });
});
