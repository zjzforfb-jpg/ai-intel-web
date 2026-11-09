import type { CSSProperties } from "react";
import { STATUS_COLOR_VAR_NAME, type OpportunityStatus } from "@/lib/opportunities-shared";

interface StatusBadgeProps {
  status: OpportunityStatus;
  className?: string;
}

/** 状态徽章：颜色走主题令牌，暗黑 / 暖风自动适配 */
export function StatusBadge({ status, className }: StatusBadgeProps) {
  const style = {
    "--status-color": `var(${STATUS_COLOR_VAR_NAME[status]})`,
  } as CSSProperties;

  return (
    <span className={`status-badge whitespace-nowrap ${className ?? ""}`} style={style}>
      <span className="status-dot" aria-hidden />
      {status}
    </span>
  );
}
