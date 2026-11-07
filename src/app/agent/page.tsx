import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AgentRunner } from "@/app/components/agent-runner";
import { PageFallback } from "@/app/components/page-fallback";
import { getStore } from "@/lib/runtime";

function DemoResetButton() {
  return <form action="/api/demo/reset" method="post"><button className="button button-quiet" type="submit">Reset demo data</button></form>;
}

export default function AgentPage() {
  return <div>
    <div className="page-heading"><p className="eyebrow">PROPOSAL WORKSPACE</p><h1>Run the agent</h1><p>Choose a confirmed mandate. The agent proposes product ids and quantities; the server prices every cart and evaluates it against the mandate.</p></div>
    <Suspense fallback={<PageFallback label="Loading confirmed mandates…" />}><AgentWorkspace /></Suspense>
    <p className="small-muted" style={{ marginTop: 18 }}>No background purchases. A person reviews every PayPal Sandbox checkout.</p>
    <Link className="text-link" href="/mandates">Manage mandates →</Link>
  </div>;
}

async function AgentWorkspace() {
  await connection();
  const mandates = (await getStore().listMandates()).filter((item) => item.status === "CONFIRMED");
  return <><AgentRunner mandates={mandates} />{process.env.DEMO_RESET_ENABLED === "true" && <div className="panel stack-md" style={{ marginTop: 24 }}><strong>Demo controls</strong><p className="small-muted">Reset demo records and reseed the sample mandate.</p><DemoResetButton /></div>}</>;
}
