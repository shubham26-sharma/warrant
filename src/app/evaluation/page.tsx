import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { connection } from "next/server";

export default async function EvaluationPage() {
  await connection();
  let result: string | null = null;
  try { result = await readFile(join(process.cwd(), "tests", "results", "latest.json"), "utf8"); }
  catch { result = null; }
  return <div className="stack-lg"><div className="page-heading"><p className="eyebrow">OFFLINE AND MODEL EVALUATION</p><h1>Evaluation</h1><p>The included scenario set checks expected guard outcomes and ambiguity handling. It is a small demo set, not a statistical safety claim.</p></div>
    {!result ? <section className="empty-state"><h2>Not run yet</h2><p>Run the evaluation in a later phase to produce tests/results/latest.json.</p></section> : <section className="panel stack-md"><h2 className="panel-title">Latest evaluation result</h2><pre className="payload evaluation-json">{JSON.stringify(JSON.parse(result) as unknown, null, 2)}</pre><p className="small-muted">Review development and held-out results separately. False approvals are highlighted by the evaluation report; 24 scenarios cannot prove real-world safety.</p></section>}
    <section className="panel"><h2 className="panel-title">Limitations</h2><p className="small-muted">This is a 24-case demonstration. Model outputs vary, the merchant catalog is fictional, and the checkout remains human-present in PayPal Sandbox.</p></section>
  </div>;
}
