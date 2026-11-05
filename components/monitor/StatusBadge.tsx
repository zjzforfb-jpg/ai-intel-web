import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import type { CheckStatus, Severity } from "@/lib/monitor/types";

const STATUS_CONFIG: Record<
  CheckStatus,
  { label: string; Icon: typeof CheckCircle2; className: string }
> = {
  ok: {
    label: "ok 通过",
    Icon: CheckCircle2,
    className:
      "bg-emerald-500/10 border-emerald-500/30 text-emerald-400",
  },
  warn: {
    label: "warn 警告",
    Icon: AlertTriangle,
    className: "bg-amber-500/10 border-amber-500/30 text-amber-400",
  },
  error: {
    label: "error 异常",
    Icon: XCircle,
    className: "bg-red-500/10 border-red-500/30 text-red-400",
  },
};

/** 检查结论徽章：ok=绿 / warn=橙 / error=红 */
export function StatusBadge({
  status,
  size = "md",
}: {
  status: CheckStatus;
  size?: "sm" | "md";
}) {
  const { label, Icon, className } = STATUS_CONFIG[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border font-medium whitespace-nowrap ${className} ${
        size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-3 py-1 text-[13px]"
      }`}
    >
      <Icon size={size === "sm" ? 12 : 14} className="shrink-0" />
      {label}
    </span>
  );
}

/** 异常明细里的严重度小徽章 */
export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-px text-[11px] font-medium whitespace-nowrap ${
        severity === "error"
          ? "bg-red-500/10 border-red-500/30 text-red-400"
          : "bg-amber-500/10 border-amber-500/30 text-amber-400"
      }`}
    >
      {severity}
    </span>
  );
}
