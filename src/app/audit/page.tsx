import { connection } from "next/server";
import { AuditTable } from "@/app/components/audit-table";
import { getStore } from "@/lib/runtime";

export default async function AuditPage() {
  await connection();
  const events = await getStore().listAuditEvents();
  return <div><div className="page-heading"><p className="eyebrow">TAMPER-EVIDENT HISTORY</p><h1>Audit trail</h1><p>Review the event sequence and verify the hash chain. The audit is an application integrity record, not a legal signature.</p></div><AuditTable events={events} /></div>;
}
