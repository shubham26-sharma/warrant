import Link from "next/link";

export default function PayPalCancelPage() {
  return <section className="panel stack-md"><p className="eyebrow">PAYPAL SANDBOX</p><h1>Checkout cancelled</h1><p>You cancelled the sandbox checkout. No payment was captured.</p><div className="row-wrap"><Link className="button button-primary" href="/agent">Return to proposals</Link><Link className="text-link" href="/audit">View audit trail</Link></div></section>;
}
