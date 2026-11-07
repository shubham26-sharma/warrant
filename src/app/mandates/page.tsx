import Link from "next/link";
import { connection } from "next/server";
import { getStore } from "@/lib/runtime";

export default async function MandatesPage() {
  await connection();
  const mandates = await getStore().listMandates();
  return <div>
    <div className="page-heading row-between"><div><p className="eyebrow">POLICY</p><h1>Mandates</h1><p>Confirmed versions define what the agent may propose. Edits create a new version.</p></div><Link className="button button-primary" href="/mandates/new">New mandate</Link></div>
    {!mandates.length ? <div className="empty-state"><h2>No mandates yet</h2><p>Create a concrete purchase mandate to start the demo.</p><Link className="button button-primary" href="/mandates/new">Create a mandate</Link></div> :
      <div className="table-scroll"><table><thead><tr><th>Family</th><th>Version</th><th>Status</th><th>Budget</th><th>Quantity</th><th>Mandate</th><th>Hash</th><th></th></tr></thead><tbody>
        {mandates.map((item) => <tr key={item.mandateId}><td><code>{item.familyId.slice(0, 8)}…</code></td><td>v{item.version}</td><td>{item.status}</td><td>${(item.hardConstraints.maximumTotalCents / 100).toFixed(2)} {item.currency}</td><td>≤ {item.hardConstraints.maximumQuantity}</td><td>{item.originalText}</td><td><code>{item.hash.slice(0, 12)}…</code></td><td>{item.status === "CONFIRMED" && <Link className="text-link" href={`/mandates/new?edit=${item.mandateId}`}>Edit version</Link>}</td></tr>)}
      </tbody></table></div>}
  </div>;
}
