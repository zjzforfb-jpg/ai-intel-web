import { getMonitorOverview, listCheckRuns } from "@/lib/monitor/store";
import type { CheckStatus } from "@/lib/monitor/types";
import { DbErrorState } from "@/components/DbErrorState";
import { OverviewCards } from "@/components/monitor/OverviewCards";
import { RunCard } from "@/components/monitor/RunCard";
import { RunFilter } from "@/components/monitor/RunFilter";
import { RunPagination } from "@/components/monitor/RunPagination";
import { isCheckStatus, toRunView } from "@/components/monitor/run-utils";
import Link from "next/link";
import { Activity, ClipboardList, TerminalSquare } from "lucide-react";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

/** 取查询参数的首个字符串值 */
function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

/** 仅接受合法状态值，其余一律按「全部」处理 */
function sanitizeStatus(v: string): CheckStatus | "" {
  return isCheckStatus(v) ? v : "";
}

function sanitizePage(v: string): number {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 100000 ? n : 1;
}

export default async function MonitorPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;

  const status = sanitizeStatus(first(sp.status));
  const page = sanitizePage(first(sp.page));

  let overview: Awaited<ReturnType<typeof getMonitorOverview>> | null = null;
  let runs: Awaited<ReturnType<typeof listCheckRuns>> | null = null;
  let dbError: string | null = null;

  try {
    [overview, runs] = await Promise.all([
      getMonitorOverview(),
      listCheckRuns({
        status: status || undefined,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      }),
    ]);
  } catch (error) {
    dbError = error instanceof Error ? error.message : "数据库查询失败（未知错误）";
  }

  if (dbError || !overview || !runs) {
    return <DbErrorState title="无法读取监控数据" detail={dbError} />;
  }

  const items = runs.items.map(toRunView);
  const { total } = runs;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const baseQuery: Record<string, string> = {};
  if (status) baseQuery.status = status;

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-5 flex flex-col gap-4">
      {/* 页头 */}
      <div>
        <h1 className="text-[22px] lg:text-[24px] font-bold text-[var(--color-text-primary)] mb-1 flex items-center gap-2.5">
          <Activity size={22} className="text-[var(--color-accent-light)]" />
          系统监控
        </h1>
        <p className="text-[13px] text-[var(--color-text-muted)]">
          日报数据质量检查的运行状态与历史记录
        </p>
      </div>

      {/* 运行状态总览 */}
      <OverviewCards overview={overview} />

      {/* 状态筛选 */}
      <RunFilter status={status} />

      {/* 结果摘要 */}
      <div className="text-[13px] text-[var(--color-text-muted)]">
        {status ? `筛选「${status}」` : "全部记录"}：共{" "}
        <span className="text-[var(--color-text-secondary)] font-medium tabular-nums">{total}</span>{" "}
        条（第 {page} / {totalPages} 页）
      </div>

      {/* 检查记录列表 */}
      {items.length > 0 ? (
        <div className="flex flex-col gap-3">
          {items.map((run) => (
            <RunCard key={run.id} run={run} />
          ))}
        </div>
      ) : (
        <div className="glass-card p-10 text-center">
          {page > totalPages ? (
            <>
              <p className="text-base text-[var(--color-text-secondary)] mb-1">当前页码超出范围</p>
              <p className="text-[13px] text-[var(--color-text-muted)] mb-5">
                共 {totalPages} 页，你访问的是第 {page} 页。
              </p>
              <Link
                href={`/monitor${Object.keys(baseQuery).length ? `?${new URLSearchParams(baseQuery).toString()}` : ""}`}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-accent)] text-white text-sm hover:opacity-90 transition-opacity"
              >
                回到第 1 页
              </Link>
            </>
          ) : status ? (
            <>
              <ClipboardList size={28} className="text-[var(--color-text-muted)] mx-auto mb-3" />
              <p className="text-base text-[var(--color-text-secondary)] mb-1">
                没有「{status}」结论的检查记录
              </p>
              <p className="text-[13px] text-[var(--color-text-muted)]">
                试试切换到其他状态查看。
              </p>
            </>
          ) : (
            <>
              <ClipboardList size={28} className="text-[var(--color-text-muted)] mx-auto mb-3" />
              <p className="text-base text-[var(--color-text-secondary)] mb-1">还没有检查记录</p>
              <p className="text-[13px] text-[var(--color-text-muted)] mb-4">
                系统执行数据质量检查后，记录会自动出现在这里。
              </p>
              <div className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-[var(--color-bg-panel)] border border-[var(--color-border-subtle)] text-[13px] text-[var(--color-text-secondary)]">
                <TerminalSquare size={14} className="text-[var(--color-accent-light)]" />
                运行 <code className="font-mono text-[var(--color-accent-light)]">npm run monitor:check</code> 触发检查
              </div>
            </>
          )}
        </div>
      )}

      {/* 分页（保留筛选条件） */}
      <RunPagination page={page} totalPages={totalPages} baseQuery={baseQuery} />
    </div>
  );
}
