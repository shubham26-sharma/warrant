import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { MandateBuilder } from "@/app/components/mandate-builder";
import { PageFallback } from "@/app/components/page-fallback";
import { getStore } from "@/lib/runtime";

export default function NewMandatePage(props: PageProps<"/mandates/new">) {
  return <Suspense fallback={<PageFallback label="Loading mandate editor…" />}><NewMandateContent {...props} /></Suspense>;
}

async function NewMandateContent({ searchParams }: PageProps<"/mandates/new">) {
  await connection();
  const { edit } = await searchParams;
  const editId = Array.isArray(edit) ? edit[0] : edit;
  const initialMandate = editId ? await getStore().getMandate(editId) : null;
  if (editId && !initialMandate) notFound();
  return <div><div className="page-heading"><p className="eyebrow">MANDATE SETUP</p><h1>{editId ? "Edit mandate" : "Create a mandate"}</h1><p>Use concrete budgets, quantities, delivery limits, and product attributes. The compiled version stays a draft until you confirm it.</p></div><MandateBuilder initialMandate={initialMandate} /></div>;
}
