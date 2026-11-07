import { connection } from "next/server";
import { Suspense } from "react";
import { AuditTable } from "@/app/components/audit-table";
import { PageFallback } from "@/app/components/page-fallback";
import { getStore } from "@/lib/runtime";

export default function AuditPage() {
  return <div><div className="page-heading"><p className="eyebrow">TAMPER-EVIDENT HISTORY</p><h1>Audit trail</h1><p>Review the event sequence and verify the hash chain. The audit is an application integrity record, not a legal signature.</p></div><Suspense fallback={<PageFallback label="Loading the latest audit events…" />}><AuditEvents /></Suspense></div>;
}

async function AuditEvents() {
  await connection();
  const events = await getStore().listAuditEvents();
  return <AuditTable events={events} />;
}
