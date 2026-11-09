import { loadScriptEnvironment } from "./env";
import { formatEnvCheckReport, inspectEnvConfiguration } from "../src/lib/env-config";

loadScriptEnvironment();

const args = process.argv.slice(2);
const hostedFlag = args.includes("--hosted") ? true : undefined;
const result = inspectEnvConfiguration(process.env, { hosted: hostedFlag });

console.log(formatEnvCheckReport(result));
if (!result.ok) {
  process.exitCode = 1;
}

