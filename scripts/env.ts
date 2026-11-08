import dotenv from "dotenv";

export function loadScriptEnvironment(): void {
  dotenv.config({ path: ".env.local" });
  dotenv.config({ path: ".env" });
}

export function requireEnvironmentVariables(names: readonly string[]): boolean {
  const missing = names.filter((name) => !process.env[name]?.trim());
  if (missing.length === 0) return true;

  console.error(`Missing required environment variable(s): ${missing.join(", ")}.`);
  console.error("Set them in .env.local or in the current process environment.");
  return false;
}
