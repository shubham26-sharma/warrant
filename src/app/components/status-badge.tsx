import type { Verdict } from "@/lib/schemas/decision";

const style: Record<Verdict, { icon: string; label: string; className: string }> = {
  APPROVE: { icon: "✓", label: "APPROVE", className: "status status-approve" },
  REVIEW: { icon: "!", label: "REVIEW", className: "status status-review" },
  BLOCK: { icon: "×", label: "BLOCK", className: "status status-block" },
};

export function StatusBadge({ verdict }: { verdict: Verdict }) {
  const item = style[verdict];
  return <span className={item.className}><span aria-hidden="true">{item.icon}</span> {item.label}</span>;
}
