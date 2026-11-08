import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadScriptEnvironment, requireEnvironmentVariables } from "./env";
import { AiUnavailableError, getAiClient } from "../src/lib/ai/client";
import { compileMandate } from "../src/lib/ai/compile-mandate";
import { createSemanticCheck } from "../src/lib/ai/semantic-check";
import { MemoryStore } from "../src/lib/store/memory";
import { confirmMandate } from "../src/lib/mandates/confirm-mandate";
import { CartSchema } from "../src/lib/schemas/cart";
import { MandateSchema } from "../src/lib/schemas/mandate";
import { evaluateCart } from "../src/lib/guard/evaluate";
import type { Verdict } from "../src/lib/schemas/decision";
import fixture from "../tests/fixtures/scenarios.json";
import compilerExtraFixture from "../tests/fixtures/compiler-extra.json";

loadScriptEnvironment();

type Mode = "baseline" | "ai";
type Scenario = {
  id: string;
  category: string;
  split: "development" | "held_out";
  expectedStage: "guard" | "compiler";
  expected: Verdict | "AMBIGUOUS";
  cart?: unknown;
  mandateText?: string;
};
type CaseResult = {
  id: string;
  category: string;
  split: "development" | "held_out";
  stage: "guard" | "compiler";
  expected: string;
  actual: string;
  pass: boolean | null;
  reasons: string[];
};
type ExtraCompilerCase = { id: string; text: string; expected: "CLEAR" | "AMBIGUOUS" };

const scenarios = fixture.scenarios as Scenario[];
const baseMandate = MandateSchema.parse(fixture.baseMandate);

function parseArgs(args: string[]): { mode: Mode; includeHeldOut: boolean } {
  let mode: Mode | undefined;
  let includeHeldOut = false;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--mode") {
      const value = args[i + 1];
      if (value !== "baseline" && value !== "ai") throw new Error("Use --mode baseline or --mode ai");
      mode = value;
      i += 1;
    } else if (args[i] === "--heldout") {
      includeHeldOut = true;
    } else {
      throw new Error(`Unknown evaluation option: ${args[i]}`);
    }
  }
  if (!mode) throw new Error("Evaluation mode is required: --mode baseline or --mode ai");
  return { mode, includeHeldOut };
}

function markdownCell(value: string): string {
  return value.replaceAll("|", "\\|").replace(/[\r\n]+/g, " ");
}

function buildMarkdown(report: {
  createdAt: string;
  mode: Mode;
  heldOutIncluded: boolean;
  notes: string[];
  results: CaseResult[];
  metrics: Record<string, unknown>;
}): string {
  const groups = report.heldOutIncluded ? ["development", "held_out"] as const : ["development"] as const;
  const lines = [
    "# Evaluation results",
    "",
    `- Run: ${report.createdAt}`,
    `- Mode: ${report.mode}`,
    `- Held-out included: ${report.heldOutIncluded ? "yes" : "no"}`,
    "- This scenario set is a small demonstration, not a statistical safety claim.",
    "",
    "## Summary",
    "",
    "```json",
    JSON.stringify(report.metrics, null, 2),
    "```",
    "",
  ];
  if (report.notes.length) {
    lines.push("## Notes", "", ...report.notes.map((note) => `- ${note}`), "");
  }
  for (const split of groups) {
    lines.push(`## ${split === "held_out" ? "Held-out" : "Development"} cases`, "", "| ID | Stage | Category | Expected | Actual | Pass | Reasons |", "| --- | --- | --- | --- | --- | --- | --- |");
    for (const row of report.results.filter((item) => item.split === split && item.category !== "compiler-extra")) {
      lines.push(`| ${row.id} | ${row.stage} | ${markdownCell(row.category)} | ${row.expected} | ${row.actual} | ${row.pass === null ? "SKIPPED" : row.pass ? "yes" : "no"} | ${markdownCell(row.reasons.join("; ") || "—")} |`);
    }
    lines.push("");
  }
  const extraCompiler = report.results.filter((item) => item.category === "compiler-extra");
  if (extraCompiler.length) {
    lines.push("## Additional compiler cases (outside the 24 scenarios)", "", "| ID | Expected | Actual | Pass | Reasons |", "| --- | --- | --- | --- | --- |");
    for (const row of extraCompiler) lines.push(`| ${row.id} | ${row.expected} | ${row.actual} | ${row.pass === null ? "SKIPPED" : row.pass ? "yes" : "no"} | ${markdownCell(row.reasons.join("; ") || "—")} |`);
    lines.push("");
  }
  lines.push("## Limitations", "", "The fixture set contains 24 scenarios and does not establish real-world safety. Model-backed results can vary. A skipped compiler case was not evaluated and must not be read as a pass.", "");
  return lines.join("\n");
}

async function main(): Promise<void> {
  const { mode, includeHeldOut } = parseArgs(process.argv.slice(2));
  if (mode === "ai" && !requireEnvironmentVariables(["GEMINI_API_KEY", "GEMINI_MODEL"])) {
    process.exitCode = 1;
    return;
  }
  if (includeHeldOut) console.warn("WARNING: held-out scenarios are for final reporting only; do not use them for tuning.");

  const selected = scenarios.filter((scenario) => includeHeldOut || scenario.split === "development");
  const results: CaseResult[] = [];
  const notes: string[] = [];
  const store = new MemoryStore();
  const client = mode === "ai" ? getAiClient() : undefined;
  const semanticCheck = mode === "baseline"
    ? async () => ({ verdict: "APPROVE" as const, reasons: ["Offline baseline semantic stub: always APPROVE"] })
    : createSemanticCheck(store, client);

  for (const scenario of selected.filter((item) => item.expectedStage === "guard")) {
    try {
      const cart = CartSchema.parse(scenario.cart);
      const decision = await evaluateCart(baseMandate, cart, semanticCheck);
      results.push({ id: scenario.id, category: scenario.category, split: scenario.split, stage: "guard", expected: scenario.expected, actual: decision.verdict, pass: decision.verdict === scenario.expected, reasons: decision.reasons });
    } catch (error) {
      results.push({ id: scenario.id, category: scenario.category, split: scenario.split, stage: "guard", expected: scenario.expected, actual: "ERROR", pass: false, reasons: [error instanceof Error ? error.message : "Evaluation failed"] });
    }
  }

  const compilerCases = selected.filter((item) => item.expectedStage === "compiler");
  const offlineBaseline = mode === "baseline";
  if (offlineBaseline) {
    const reason = "Skipped: offline baseline does not make Gemini calls.";
    notes.push(`${reason} Compiler cases: ${compilerCases.map((item) => item.id).join(", ") || "none"}.`);
    for (const scenario of compilerCases) {
      results.push({ id: scenario.id, category: scenario.category, split: scenario.split, stage: "compiler", expected: scenario.expected, actual: "SKIPPED", pass: null, reasons: [reason] });
    }
  } else {
    for (const scenario of compilerCases) {
      try {
        const draft = await compileMandate(scenario.mandateText ?? "", baseMandate.currency, client);
        let confirmationRefused = false;
        if (draft.hardConstraints.maximumTotalCents !== null && draft.hardConstraints.maximumQuantity !== null && draft.hardConstraints.maximumDeliveryDays !== null) {
          try { confirmMandate(MandateSchema.parse(draft), {}); } catch { confirmationRefused = true; }
        } else {
          confirmationRefused = true;
        }
        const ambiguityDetected = draft.ambiguity.hasAmbiguity && draft.ambiguity.unresolvedClauses.length > 0;
        const passed = ambiguityDetected && confirmationRefused;
        results.push({
          id: scenario.id, category: scenario.category, split: scenario.split, stage: "compiler", expected: scenario.expected,
          actual: passed ? "AMBIGUOUS" : ambiguityDetected ? "CONFIRMATION_ALLOWED" : "NOT_AMBIGUOUS", pass: passed,
          reasons: [...draft.ambiguity.unresolvedClauses, ...(confirmationRefused ? ["Unedited draft confirmation was refused"] : ["Unedited draft confirmation was not refused"])],
        });
      } catch (error) {
        const detail = error instanceof AiUnavailableError ? "AI check unavailable" : error instanceof Error ? error.message : "Compiler evaluation failed";
        results.push({ id: scenario.id, category: scenario.category, split: scenario.split, stage: "compiler", expected: scenario.expected, actual: "ERROR", pass: false, reasons: [detail] });
      }
    }
    const extraCases: ExtraCompilerCase[] = [
      ...compilerExtraFixture.clean.map((item) => ({ ...item, expected: "CLEAR" as const })),
      ...compilerExtraFixture.vague.map((item) => ({ ...item, expected: "AMBIGUOUS" as const })),
    ];
    for (const item of extraCases) {
      try {
        const draft = await compileMandate(item.text, baseMandate.currency, client);
        const actual = draft.ambiguity.hasAmbiguity ? "AMBIGUOUS" : "CLEAR";
        const pass = actual === item.expected && draft.status === "DRAFT";
        results.push({ id: item.id, category: "compiler-extra", split: "development", stage: "compiler", expected: item.expected, actual, pass, reasons: [...draft.ambiguity.unresolvedClauses, `Compiler returned ${draft.status}`] });
      } catch (error) {
        const detail = error instanceof AiUnavailableError ? "AI check unavailable" : error instanceof Error ? error.message : "Compiler evaluation failed";
        results.push({ id: item.id, category: "compiler-extra", split: "development", stage: "compiler", expected: item.expected, actual: "ERROR", pass: false, reasons: [detail] });
      }
    }
  }

  results.sort((a, b) => a.split.localeCompare(b.split) || a.id.localeCompare(b.id));
  const guardResults = results.filter((item) => item.stage === "guard" && item.pass !== null);
  const compilerResults = results.filter((item) => item.stage === "compiler");
  const metrics = {
    evaluatedCases: results.filter((item) => item.pass !== null).length,
    skippedCases: results.filter((item) => item.pass === null).length,
    correctApprovals: guardResults.filter((item) => item.expected === "APPROVE" && item.actual === "APPROVE").length,
    correctBlocks: guardResults.filter((item) => item.expected === "BLOCK" && item.actual === "BLOCK").length,
    correctReviews: guardResults.filter((item) => item.expected === "REVIEW" && item.actual === "REVIEW").length,
    ambiguityDetection: {
      detected: compilerResults.filter((item) => item.pass === true).length,
      evaluated: compilerResults.filter((item) => item.pass !== null).length,
      skipped: compilerResults.filter((item) => item.pass === null).length,
    },
    falseApprovals: guardResults.filter((item) => item.expected !== "APPROVE" && item.actual === "APPROVE").length,
    falseBlocks: guardResults.filter((item) => item.expected !== "BLOCK" && item.actual === "BLOCK").length,
    mismatches: results.filter((item) => item.pass === false).length,
  };
  const report = {
    createdAt: new Date().toISOString(),
    mode,
    heldOutIncluded: includeHeldOut,
    notes,
    metrics,
    results,
  };
  const resultsDirectory = join(process.cwd(), "tests", "results");
  await mkdir(resultsDirectory, { recursive: true });
  const fileStamp = report.createdAt.replace(/[:.]/g, "-");
  await writeFile(join(resultsDirectory, `${fileStamp}-${mode}.json`), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(join(resultsDirectory, "latest.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(join(resultsDirectory, "RESULTS.md"), buildMarkdown(report), "utf8");

  console.log("ID  SPLIT       STAGE     EXPECTED    ACTUAL      PASS  REASONS");
  for (const row of results) console.log(`${row.id.padEnd(3)} ${row.split.padEnd(11)} ${row.stage.padEnd(9)} ${row.expected.padEnd(11)} ${row.actual.padEnd(11)} ${row.pass === null ? "SKIP" : row.pass ? "yes" : "no"}   ${row.reasons.join("; ") || "—"}`);
  console.log(`\nMetrics: ${JSON.stringify(metrics)}`);
  for (const note of notes) console.log(note);
  console.log(`Wrote tests/results/${fileStamp}-${mode}.json, tests/results/latest.json, and tests/results/RESULTS.md`);
  if (metrics.falseApprovals > 0 || metrics.mismatches > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Evaluation failed");
  process.exitCode = 1;
});
