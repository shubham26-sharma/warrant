import { loadScriptEnvironment, requireEnvironmentVariables } from "./env";
import { compileMandate } from "../src/lib/ai/compile-mandate";

loadScriptEnvironment();

const [currency = "USD", ...requestParts] = process.argv.slice(2);
const request = requestParts.join(" ").trim();
if (!request) {
  console.error("Usage: npm run try:compile -- USD 'Buy five packs of recycled A4 paper under $60 within 3 days from the demo store only'");
  process.exitCode = 2;
} else {
  const configured = requireEnvironmentVariables(["GEMINI_API_KEY", "GEMINI_MODEL"]);
  if (!configured) process.exitCode = 1;
  else compileMandate(request, currency)
    .then((mandate) => console.log(JSON.stringify(mandate, null, 2)))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : "Mandate compilation failed");
      process.exitCode = 1;
    });
}
