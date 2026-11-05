// 运行状态总览 —— Owner: Agent C
import { formatDateTime } from "@/lib/format";
import type { CheckStatus } from "@/lib/monitor/types";
import { StatusBadge } from "./StatusBadge";

export interface MonitorOverview {
  lastCheckAt: string | null;
  lastCheckStatus: CheckStatus | null;
  latestReportDate: string | null;
  issueCount24h: number;
  checks7d: number;
  errors7d: number;
}

function StatCell({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="px-4 py-3 min-w-0">
      <div className="text-[11px] text-[var(--color-text-muted)] mb-1">{label}</div>
      <div
        className="text-[15px] font-semibold text-[var(--color-text-primary)] tabular-nums min-w-0"
        style={{ overflowWrap: "anywhere" }}
      >
        {children}
      </div>
    </div>
  );
}

/** 页头运行状态总览：最近检查 / 结论 / 最近报告日期 / 24h 异常 / 7 天统计 */
export function OverviewCards({ overview }: { overview: MonitorOverview }) {
  return (
    <div className="glass-card grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 divide-x divide-y sm:divide-y-0 divide-[var(--color-border-subtle)] overflow-hidden">
      <StatCell label="最近检查时间">
        {overview.lastCheckAt ? (
          formatDateTime(overview.lastCheckAt)
        ) : (
          <span className="text-[var(--color-text-muted)] font-normal">尚未检查</span>
        )}
      </StatCell>

      <StatCell label="最近检查结论">
        {overview.lastCheckStatus ? (
          <StatusBadge status={overview.lastCheckStatus} size="sm" />
        ) : (
          <span className="text-[var(--color-text-muted)] font-normal">—</span>
        )}
      </StatCell>

      <StatCell label="最近成功报告日期">
        {overview.latestReportDate ? (
          overview.latestReportDate
        ) : (
          <span className="text-[var(--color-text-muted)] font-normal">暂无报告</span>
        )}
      </StatCell>

      <StatCell label="近 24 小时异常数">
        <span
          className={
            overview.issueCount24h > 0
              ? "text-red-400"
              : "text-emerald-400"
          }
        >
          {overview.issueCount24h}
        </span>
      </StatCell>

      <StatCell label="近 7 天检查 / 异常">
        <span>{overview.checks7d}</span>
        <span className="text-[var(--color-text-muted)] font-normal"> / </span>
        <span className={overview.errors7d > 0 ? "text-red-400" : "text-emerald-400"}>
          {overview.errors7d}
        </span>
      </StatCell>
    </div>
  );
}
