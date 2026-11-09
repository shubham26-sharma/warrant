import { afterEach, describe, expect, it, vi } from "vitest";
import { requireEnvironmentVariables } from "../../scripts/env";
import { formatEnvCheckReport, getDeepHealthConfig, inspectEnvConfiguration } from "../../src/lib/env-config";

function validHostedEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "production",
    PAYPAL_CLIENT_ID: "paypal-client-secret-sentinel",
    PAYPAL_CLIENT_SECRET: "paypal-secret-sentinel",
    DATABASE_URL: "postgresql://dbuser:dbpass-sentinel@ep-pooler.us-east-1.aws.neon.tech/neondb?sslmode=verify-full",
    DIRECT_URL: "postgresql://dbuser:dbpass-sentinel@ep-direct.us-east-1.aws.neon.tech/neondb?sslmode=verify-full",
    GEMINI_API_KEY: "gemini-key-sentinel",
    GEMINI_MODEL: "gemini-3.5-flash-lite",
    AUDIT_HMAC_SECRET: "hmac-secret-sentinel-value",
    APP_BASE_URL: "https://warrant-xcon.onrender.com",
    NODE_VERSION: "24.22.1",
    ...overrides,
  };
}

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

  it("validates well-formed hosted configuration without printing any env values", () => {
    const env = validHostedEnv();
    const result = inspectEnvConfiguration(env, { hosted: true });
    const report = formatEnvCheckReport(result);

    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.invalid).toEqual([]);
    expect(getDeepHealthConfig(env)).toEqual({ ok: true, missing: [] });
    expect(report).not.toContain("sentinel");
    expect(report).not.toContain("warrant-xcon");
    expect(report).not.toContain("gemini-3.5-flash-lite");
    expect(report).not.toContain("dbuser");
  });

  it("flags missing and malformed variables by name only without leaking values", () => {
    const env = validHostedEnv({
      DATABASE_URL: "mysql://leak-sentinel-db/warrant",
      DIRECT_URL: "postgresql://leak-sentinel-direct/warrant",
      APP_BASE_URL: "http://leak-sentinel.example.com",
      PAYPAL_BASE_URL: "https://api-m.paypal.com/leak-sentinel",
      GEMINI_MODEL: "",
      DEMO_RESET_ENABLED: "true",
    });

    const result = inspectEnvConfiguration(env, { hosted: true });
    const report = formatEnvCheckReport(result);

    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(["GEMINI_MODEL"]);
    expect(result.invalid).toEqual([
      "DATABASE_URL",
      "DIRECT_URL",
      "APP_BASE_URL",
      "PAYPAL_BASE_URL",
      "DEMO_RESET_ENABLED",
    ]);
    expect(getDeepHealthConfig(env)).toEqual({ ok: false, missing: ["GEMINI_MODEL"] });
    expect(report).not.toContain("sentinel");
    expect(report).not.toContain("api-m.paypal.com");
  });

  it("allows http localhost and unset NODE_VERSION in local mode, while requiring both in hosted mode", () => {
    const localEnv = validHostedEnv({
      NODE_ENV: "development",
      APP_BASE_URL: "http://localhost:3000",
      NODE_VERSION: undefined,
    });

    const localResult = inspectEnvConfiguration(localEnv, { hosted: false });
    expect(localResult.ok).toBe(true);
    expect(localResult.missing).toEqual([]);

    const hostedResult = inspectEnvConfiguration(localEnv, { hosted: true });
    expect(hostedResult.ok).toBe(false);
    expect(hostedResult.missing).toEqual(["NODE_VERSION"]);
    expect(hostedResult.invalid).toEqual(["APP_BASE_URL"]);
  });
});
