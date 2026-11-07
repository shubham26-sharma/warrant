import { connection } from "next/server";
import { PayPalReturnClient } from "@/app/components/paypal-return-client";

export default async function PayPalReturnPage({ searchParams }: PageProps<"/paypal/return">) {
  await connection();
  const params = await searchParams;
  const token = params.token;
  const orderParam = params.orderID;
  const orderId = (Array.isArray(token) ? token[0] : token) ?? (Array.isArray(orderParam) ? orderParam[0] : orderParam) ?? "";
  return <div className="page-heading"><p className="eyebrow">CHECKOUT RETURN</p><h1>PayPal Sandbox</h1><PayPalReturnClient orderId={orderId} /></div>;
}
