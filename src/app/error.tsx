"use client";

import Link from "next/link";

export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <section className="panel stack-md" role="alert"><p className="eyebrow">WARRANT</p><h1>We couldn’t load this page</h1><p className="small-muted">Your saved decision data has not been changed. Try again or return to the overview.</p><div className="row-wrap"><button className="button button-primary" type="button" onClick={reset}>Try again</button><Link className="button button-quiet" href="/">Overview</Link></div></section>;
}
