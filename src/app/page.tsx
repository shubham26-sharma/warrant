import Link from "next/link";

export default function HomePage() {
  return <div className="stack-lg">
    <section className="hero">
      <div><p className="eyebrow">BUYER-SIDE PURCHASE AUTHORIZATION</p><h1>Let agents propose.<br />Keep people in control.</h1><p>Warrant checks an AI agent’s proposed office-supply cart against a manager-confirmed mandate before a PayPal order can be created. Every checkout stays in PayPal Sandbox and requires a human present.</p><div className="row-wrap"><Link className="button button-primary" href="/agent">Start demo</Link><Link className="button button-quiet" href="/mandates/new">Create a mandate</Link></div></div>
      <div className="hero-side"><span className="sandbox-pill">● Sandbox, no real money</span><div className="hero-step"><span className="step-number">1</span><div><strong>Set the mandate</strong><p className="small-muted">A manager states concrete limits and requirements.</p></div></div><div className="hero-step"><span className="step-number">2</span><div><strong>Agent proposes a cart</strong><p className="small-muted">The server looks up products and prices.</p></div></div><div className="hero-step"><span className="step-number">3</span><div><strong>Warrant checks, human pays</strong><p className="small-muted">Hard rules and AI review run before PayPal Sandbox.</p></div></div></div>
    </section>
    <section className="three-grid">
      <article className="panel feature-card"><p className="eyebrow">APPROVE</p><h3>Within the mandate</h3><p>All deterministic checks pass. A human can continue to PayPal Sandbox.</p></article>
      <article className="panel feature-card"><p className="eyebrow" style={{ color: "#8a5b08" }}>REVIEW</p><h3>Needs attention</h3><p>Missing or uncertain information asks for manager review and a recorded note.</p></article>
      <article className="panel feature-card"><p className="eyebrow" style={{ color: "#a33d37" }}>BLOCK</p><h3>Hard rule failed</h3><p>Budget, merchant, quantity, delivery, or attribute rules cannot be overridden.</p></article>
    </section>
    <section className="panel"><h2 className="panel-title">What Warrant is not</h2><p className="small-muted">Warrant does not make autonomous payments, replace PayPal, certify AP2 compliance, or prove real-world safety. It is a human-present demo using a fictional merchant and sandbox transactions.</p></section>
  </div>;
}
