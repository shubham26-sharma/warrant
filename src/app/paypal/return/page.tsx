import { connection } from "next/server";
import { Suspense } from "react";
import { PayPalReturnClient } from "@/app/components/paypal-return-client";
import { PageFallback } from "@/app/components/page-fallback";

export default function PayPalReturnPage(props: PageProps<"/paypal/return">) {
  return <Suspense fallback={<PageFallback label="Loading PayPal return status…" />}><PayPalReturnContent {...props} /></Suspense>;
}

async function PayPalReturnContent({ searchParams }: PageProps<"/paypal/return">) {
  await connection();
  const params = await searchParams;
  const token = params.token;
  const orderParam = params.orderID;
  const orderId = (Array.isArray(token) ? token[0] : token) ?? (Array.isArray(orderParam) ? orderParam[0] : orderParam) ?? "";
  return <div className="page-heading"><p className="eyebrow">CHECKOUT RETURN</p><h1>PayPal Sandbox</h1><PayPalReturnClient orderId={orderId} /></div>;
}
