export function PageFallback({ label }: { label: string }) {
  return <section className="empty-state" role="status" aria-live="polite"><p className="eyebrow">WARRANT</p><p>{label}</p></section>;
}
