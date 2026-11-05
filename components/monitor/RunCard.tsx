// 单条检查记录卡片（含可展开异常明细） —— Owner: Agent C
import { formatDateTime } from "@/lib/format";
import { CalendarDays, ChevronDown } from "lucide-react";
import type { QualityIssue } from "@/lib/monitor/types";
import { SeverityBadge, StatusBadge } from "./StatusBadge";
import type { RunView } from "./run-utils";

function IssueRow({ issue }: { issue: QualityIssue }) {
  const metaEntries = issue.meta ? Object.entries(issue.meta) : [];
  return (
    <li className="py-2 first:pt-0 last:pb-0">
      <div className="flex items-center gap-2 flex-wrap">
        <SeverityBadge severity={issue.severity} />
        <code className="text-[11px] px-1.5 py-0.5 rounded bg-[var(--color-bg-panel)] border border-[var(--color-border-subtle)] text-[var(--color-accent-light)]">
          {issue.code}
        </code>
      </div>
      <p
        className="text-[13px] text-[var(--color-text-secondary)] mt-1 leading-relaxed"
        style={{ overflowWrap: "anywhere" }}
      >
        {issue.message}
      </p>
      {metaEntries.length > 0 && (
        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
          {metaEntries.map(([k, v]) => (
            <span
              key={k}
              className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-[var(--color-bg-panel)] border border-[var(--color-border-subtle)] text-[var(--color-text-muted)]"
            >
              <span className="font-mono">{k}</span>
              <span>=</span>
              <span className="text-[var(--color-text-secondary)]">{String(v)}</span>
            </span>
          ))}
        </div>
      )}
    </li>
  );
}

/** 检查记录卡片：时间 / 目标日期 / 结论徽章 / 摘要 / 异常明细展开 */
export function RunCard({ run }: { run: RunView }) {
  return (
    <div className="glass-card p-5">
      <div className="flex items-start gap-3 flex-wrap">
        <StatusBadge status={run.status} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-x-4 gap-y-1 flex-wrap text-[13px] text-[var(--color-text-muted)]">
            <span className="tabular-nums">{formatDateTime(run.checkedAt)}</span>
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays size={13} />
              {run.targetDate ? (
                <>
                  目标日期{" "}
                  <span className="text-[var(--color-text-secondary)] tabular-nums">
                    {run.targetDate}
                  </span>
                </>
              ) : (
                "全局检查"
              )}
            </span>
            <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-[var(--color-bg-panel)] border border-[var(--color-border-subtle)]">
              {run.checkType}
            </span>
          </div>

          <p
            className="text-[14px] text-[var(--color-text-primary)] mt-2 leading-relaxed"
            style={{ overflowWrap: "anywhere" }}
          >
            {run.summary}
          </p>
        </div>
      </div>

      {/* 异常明细：默认折叠，点击展开 */}
      {run.issues.length > 0 && (
        <details className="mt-3 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-card)]">
          <summary className="flex items-center gap-2 px-3.5 py-2.5 cursor-pointer select-none list-none text-[13px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors [&::-webkit-details-marker]:hidden">
            <ChevronDown size={14} className="shrink-0" />
            异常明细
            <span
              className={`tabular-nums font-medium ${
                run.status === "error" ? "text-red-400" : "text-amber-400"
              }`}
            >
              {run.issues.length}
            </span>
            项
          </summary>
          <ul className="px-3.5 pb-3 border-t border-[var(--color-border-subtle)] divide-y divide-[var(--color-border-subtle)]">
            {run.issues.map((issue, idx) => (
              <IssueRow key={`${issue.code}-${idx}`} issue={issue} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
