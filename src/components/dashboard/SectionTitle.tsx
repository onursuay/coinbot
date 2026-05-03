import type { LucideIcon } from "lucide-react";

export function DashboardSectionTitle({
  icon: Icon,
  title,
}: {
  icon: LucideIcon;
  title: string;
}) {
  return (
    <div className="dashboard-section-title">
      <span className="dashboard-section-title__icon" aria-hidden="true">
        <Icon className="h-4 w-4" strokeWidth={2} />
      </span>
      <span className="dashboard-section-title__text">{title}</span>
    </div>
  );
}
