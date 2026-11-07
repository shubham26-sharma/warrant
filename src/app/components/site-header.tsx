import Link from "next/link";

const links = [
  ["Overview", "/"], ["Mandates", "/mandates"], ["New mandate", "/mandates/new"],
  ["Agent", "/agent"], ["Audit", "/audit"], ["Evaluation", "/evaluation"],
] as const;

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link className="brand" href="/" aria-label="Warrant overview"><span className="brand-mark">W</span><span>Warrant</span></Link>
        <nav className="main-nav" aria-label="Main navigation">
          {links.map(([label, href]) => <Link href={href} key={href}>{label}</Link>)}
        </nav>
        <span className="sandbox-pill"><span aria-hidden="true">●</span> Sandbox</span>
      </div>
    </header>
  );
}
