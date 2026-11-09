import {
  DB_TIMEOUT_MAX_MS,
  DB_TIMEOUT_MIN_MS,
  DEFAULT_DB_CONNECT_TIMEOUT_MS,
  DEFAULT_DB_QUERY_TIMEOUT_MS,
  DbTimeoutEnvSchema,
  type DbTimeoutEnvName,
} from "./timeout";

export const PAYPAL_SANDBOX_API_BASE = "https://api-m.sandbox.paypal.com";

export const REQUIRED_ENV_NAMES = [
  "PAYPAL_CLIENT_ID",
  "PAYPAL_CLIENT_SECRET",
  "DATABASE_URL",
  "DIRECT_URL",
  "GEMINI_API_KEY",
  "GEMINI_MODEL",
  "AUDIT_HMAC_SECRET",
  "APP_BASE_URL",
  "NODE_VERSION",
] as const;

export const OPTIONAL_ENV_NAMES = [
  "PAYPAL_BASE_URL",
  "AI_TIMEOUT_MS",
  "DB_CONNECT_TIMEOUT_MS",
  "DB_QUERY_TIMEOUT_MS",
  "DEMO_RESET_ENABLED",
] as const;

export type RequiredEnvName = (typeof REQUIRED_ENV_NAMES)[number];
export type OptionalEnvName = (typeof OPTIONAL_ENV_NAMES)[number];
export type EnvCheckStatus = "ok" | "missing" | "invalid";

export interface EnvCheckItem {
  name: string;
  required: boolean;
  status: EnvCheckStatus;
  message: string;
}

export interface EnvInspectionResult {
  ok: boolean;
  hosted: boolean;
  missing: string[];
  invalid: string[];
  checks: EnvCheckItem[];
}

export interface DeepHealthConfig {
  ok: boolean;
  missing: string[];
}

export function isHostedEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.RENDER === "true" || Boolean(env.RENDER_EXTERNAL_URL?.trim()) || env.NODE_ENV === "production";
}

export function getMissingRequiredEnvNames(env: NodeJS.ProcessEnv = process.env): string[] {
  return REQUIRED_ENV_NAMES.filter((name) => !env[name]?.trim());
}

export function getDeepHealthConfig(env: NodeJS.ProcessEnv = process.env): DeepHealthConfig {
  const missing = getMissingRequiredEnvNames(env);
  return { ok: missing.length === 0, missing };
}

function checkPostgresUrl(name: "DATABASE_URL" | "DIRECT_URL", env: NodeJS.ProcessEnv): EnvCheckItem {
  const value = env[name]?.trim();
  if (!value) {
    return { name, required: true, status: "missing", message: "missing (expected postgresql:// URL with sslmode)" };
  }
  if (!value.startsWith("postgresql://")) {
    return { name, required: true, status: "invalid", message: "must start with postgresql://" };
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { name, required: true, status: "invalid", message: "is not a valid URL" };
  }
  if (!parsed.hostname) {
    return { name, required: true, status: "invalid", message: "must include a database host" };
  }
  const sslmode = parsed.searchParams.get("sslmode")?.trim();
  if (!sslmode) {
    return { name, required: true, status: "invalid", message: "must include an sslmode query parameter" };
  }
  const note = sslmode === "verify-full"
    ? "starts with postgresql:// and includes sslmode=verify-full"
    : "starts with postgresql:// and includes sslmode (verify-full recommended for Neon)";
  return { name, required: true, status: "ok", message: note };
}

function checkNonEmptySecret(name: "PAYPAL_CLIENT_ID" | "PAYPAL_CLIENT_SECRET" | "GEMINI_API_KEY" | "GEMINI_MODEL", env: NodeJS.ProcessEnv): EnvCheckItem {
  const value = env[name]?.trim();
  if (!value) {
    return { name, required: true, status: "missing", message: "missing" };
  }
  if (/\s/.test(value)) {
    return { name, required: true, status: "invalid", message: "must not contain whitespace" };
  }
  return { name, required: true, status: "ok", message: "present and non-empty" };
}

function checkAuditSecret(env: NodeJS.ProcessEnv): EnvCheckItem {
  const value = env.AUDIT_HMAC_SECRET?.trim();
  if (!value) {
    return { name: "AUDIT_HMAC_SECRET", required: true, status: "missing", message: "missing" };
  }
  const note = value.length >= 16
    ? "present and non-empty"
    : "present and non-empty (16+ characters recommended)";
  return { name: "AUDIT_HMAC_SECRET", required: true, status: "ok", message: note };
}

function checkAppBaseUrl(env: NodeJS.ProcessEnv, hosted: boolean): EnvCheckItem {
  const value = env.APP_BASE_URL?.trim();
  if (!value) {
    return {
      name: "APP_BASE_URL",
      required: true,
      status: "missing",
      message: hosted ? "missing (must be an https:// URL on hosted)" : "missing",
    };
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { name: "APP_BASE_URL", required: true, status: "invalid", message: "is not a valid URL" };
  }
  if ((parsed.protocol !== "https:" && parsed.protocol !== "http:") || !parsed.hostname) {
    return { name: "APP_BASE_URL", required: true, status: "invalid", message: "must be an http(s) URL with a hostname" };
  }
  if (parsed.search || parsed.hash) {
    return { name: "APP_BASE_URL", required: true, status: "invalid", message: "must not include query parameters or fragments" };
  }
  if (hosted && parsed.protocol !== "https:") {
    return { name: "APP_BASE_URL", required: true, status: "invalid", message: "must use https:// on hosted deployments" };
  }
  if (hosted && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1")) {
    return { name: "APP_BASE_URL", required: true, status: "invalid", message: "must not point to localhost on hosted deployments" };
  }
  return {
    name: "APP_BASE_URL",
    required: true,
    status: "ok",
    message: parsed.protocol === "https:" ? "valid https:// URL" : "valid http:// URL for local use (use https:// on hosted)",
  };
}

function checkNodeVersion(env: NodeJS.ProcessEnv, hosted: boolean): EnvCheckItem {
  const value = env.NODE_VERSION?.trim();
  if (!value) {
    if (!hosted) {
      const major = Number(process.versions.node.split(".")[0]);
      if (Number.isFinite(major) && major >= 20) {
        return {
          name: "NODE_VERSION",
          required: false,
          status: "ok",
          message: `unset in env; active Node runtime ${process.versions.node} satisfies 20+ (set NODE_VERSION in Render)`,
        };
      }
    }
    return {
      name: "NODE_VERSION",
      required: hosted,
      status: "missing",
      message: `missing in env (active Node runtime is ${process.versions.node})`,
    };
  }
  const match = /^v?(\d+)(?:\.\d+\.\d+)?$/.exec(value);
  if (!match || Number(match[1]) < 20) {
    return { name: "NODE_VERSION", required: hosted, status: "invalid", message: "must specify Node.js 20+" };
  }
  return { name: "NODE_VERSION", required: hosted, status: "ok", message: "valid Node.js 20+ version" };
}

function checkPayPalBaseUrl(env: NodeJS.ProcessEnv): EnvCheckItem {
  const configured = env.PAYPAL_BASE_URL?.trim() || env.PAYPAL_API_BASE_URL?.trim();
  if (!configured) {
    return {
      name: "PAYPAL_BASE_URL",
      required: false,
      status: "ok",
      message: `uses Sandbox endpoint (${PAYPAL_SANDBOX_API_BASE})`,
    };
  }
  try {
    const parsed = new URL(configured);
    if (parsed.origin === PAYPAL_SANDBOX_API_BASE) {
      return { name: "PAYPAL_BASE_URL", required: false, status: "ok", message: `matches Sandbox endpoint (${PAYPAL_SANDBOX_API_BASE})` };
    }
  } catch {
    // Fall through to invalid status without echoing the raw value.
  }
  return {
    name: "PAYPAL_BASE_URL",
    required: false,
    status: "invalid",
    message: `must match Sandbox endpoint (${PAYPAL_SANDBOX_API_BASE})`,
  };
}

function checkAiTimeoutMs(env: NodeJS.ProcessEnv): EnvCheckItem {
  const value = env.AI_TIMEOUT_MS?.trim();
  if (!value) {
    return { name: "AI_TIMEOUT_MS", required: false, status: "ok", message: "unset (defaults to 15000ms)" };
  }
  const parsed = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(parsed) || parsed < 1 || parsed > 120_000) {
    return { name: "AI_TIMEOUT_MS", required: false, status: "invalid", message: "must be an integer between 1 and 120000" };
  }
  return { name: "AI_TIMEOUT_MS", required: false, status: "ok", message: "valid integer timeout within 1..120000" };
}

function checkDbTimeoutMs(name: DbTimeoutEnvName, defaultMs: number, env: NodeJS.ProcessEnv): EnvCheckItem {
  const value = env[name]?.trim();
  if (!value) {
    return { name, required: false, status: "ok", message: `unset (defaults to ${defaultMs}ms)` };
  }
  if (!DbTimeoutEnvSchema.safeParse(value).success) {
    return {
      name,
      required: false,
      status: "invalid",
      message: `must be an integer between ${DB_TIMEOUT_MIN_MS} and ${DB_TIMEOUT_MAX_MS}`,
    };
  }
  return {
    name,
    required: false,
    status: "ok",
    message: `valid integer timeout within ${DB_TIMEOUT_MIN_MS}..${DB_TIMEOUT_MAX_MS}`,
  };
}

function checkDemoResetEnabled(env: NodeJS.ProcessEnv, hosted: boolean): EnvCheckItem {
  const value = env.DEMO_RESET_ENABLED?.trim();
  if (hosted && value === "true") {
    return { name: "DEMO_RESET_ENABLED", required: false, status: "invalid", message: "must stay unset or false in production" };
  }
  return {
    name: "DEMO_RESET_ENABLED",
    required: false,
    status: "ok",
    message: value === "true" ? "enabled for local demo only" : "unset/disabled (safe for production)",
  };
}

export function inspectEnvConfiguration(
  env: NodeJS.ProcessEnv = process.env,
  options: { hosted?: boolean } = {},
): EnvInspectionResult {
  const hosted = options.hosted ?? isHostedEnvironment(env);
  const checks: EnvCheckItem[] = [
    checkNonEmptySecret("PAYPAL_CLIENT_ID", env),
    checkNonEmptySecret("PAYPAL_CLIENT_SECRET", env),
    checkPostgresUrl("DATABASE_URL", env),
    checkPostgresUrl("DIRECT_URL", env),
    checkNonEmptySecret("GEMINI_API_KEY", env),
    checkNonEmptySecret("GEMINI_MODEL", env),
    checkAuditSecret(env),
    checkAppBaseUrl(env, hosted),
    checkNodeVersion(env, hosted),
    checkPayPalBaseUrl(env),
    checkAiTimeoutMs(env),
    checkDbTimeoutMs("DB_CONNECT_TIMEOUT_MS", DEFAULT_DB_CONNECT_TIMEOUT_MS, env),
    checkDbTimeoutMs("DB_QUERY_TIMEOUT_MS", DEFAULT_DB_QUERY_TIMEOUT_MS, env),
    checkDemoResetEnabled(env, hosted),
  ];

  const missing = checks.filter((item) => item.required && item.status === "missing").map((item) => item.name);
  const invalid = checks.filter((item) => item.status === "invalid").map((item) => item.name);
  return {
    ok: missing.length === 0 && invalid.length === 0,
    hosted,
    missing,
    invalid,
    checks,
  };
}

export function formatEnvCheckReport(result: EnvInspectionResult): string {
  const lines = [
    `Environment configuration check (${result.hosted ? "hosted" : "local"} mode; values are never printed):`,
    ...result.checks.map((item) => `[${item.status.toUpperCase()}] ${item.name}: ${item.message}`),
  ];
  if (result.missing.length > 0) {
    lines.push(`Missing required variable(s): ${result.missing.join(", ")}`);
  }
  if (result.invalid.length > 0) {
    lines.push(`Malformed variable(s): ${result.invalid.join(", ")}`);
  }
  if (result.ok) {
    lines.push("All required environment variables are present and well-formed.");
  }
  return lines.join("\n");
}
