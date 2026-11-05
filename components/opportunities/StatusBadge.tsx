import { STATUS_BADGE_CLASS, STATUS_DOT_CLASS, type OpportunityStatus } from "@/lib/opportunities-shared";

interface StatusBadgeProps {
  status: OpportunityStatus;
  className?: string;
}

/** 状态徽章：待研究=蓝 / 验证中=橙 / 已实施=绿 / 已放弃=灰 */
export function StatusBadge({ status, className }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[13px] font-medium whitespace-nowrap ${STATUS_BADGE_CLASS[status]} ${className ?? ""}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT_CLASS[status]}`} aria-hidden />
      {status}
    </span>
  );
}
