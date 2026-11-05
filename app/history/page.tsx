import { searchArchive, getArchiveFacets, ARCHIVE_PAGE_SIZE } from "@/lib/db";
import { parseKeywords, buildSnippet } from "@/lib/search";
import { formatDate, formatDateTime } from "@/lib/format";
import { SearchControls, type HistoryQueryState } from "@/components/history/SearchControls";
import { SearchSnippet } from "@/components/history/SearchSnippet";
import { Pagination } from "@/components/history/Pagination";
import { DbErrorState } from "@/components/DbErrorState";
import Link from "next/link";
import { FileText, ArrowRight, SearchX, CalendarDays, Database } from "lucide-react";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

/** 取查询参数的首个字符串值 */
function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

/** 仅接受合法 YYYY-MM-DD，其余一律忽略（不把非法值传给数据库） */
function sanitizeDate(v: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return "";
  return Number.isNaN(new Date(`${v}T00:00:00Z`).getTime()) ? "" : v;
}

function sanitizeYear(v: string): string {
  return /^\d{4}$/.test(v) ? v : "";
}

function sanitizeMonth(v: string): string {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 12 ? String(n) : "";
}

function sanitizePage(v: string): number {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 100000 ? n : 1;
}

export default async function HistoryPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;

  const qRaw = first(sp.q).slice(0, 200);
  const keywords = parseKeywords(qRaw);
  const from = sanitizeDate(first(sp.from));
  const to = sanitizeDate(first(sp.to));
  const year = sanitizeYear(first(sp.year));
  const month = sanitizeMonth(first(sp.month));
  const page = sanitizePage(first(sp.page));

  let facets: Awaited<ReturnType<typeof getArchiveFacets>> | null = null;
  let result: Awaited<ReturnType<typeof searchArchive>> | null = null;
  let dbError: string | null = null;

  try {
    [facets, result] = await Promise.all([
      getArchiveFacets(),
      searchArchive({
        keywords,
        dateFrom: from || null,
        dateTo: to || null,
        year: year ? Number(year) : null,
        month: month ? Number(month) : null,
        page,
        size: ARCHIVE_PAGE_SIZE,
      }),
    ]);
  } catch (error) {
    dbError = error instanceof Error ? error.message : "数据库查询失败（未知错误）";
  }

  if (dbError || !facets || !result) {
    return <DbErrorState title="无法读取历史档案" detail={dbError} />;
  }

  const { items, total } = result;
  const totalPages = Math.max(1, Math.ceil(total / ARCHIVE_PAGE_SIZE));
  const hasCondition = !!(keywords.length || from || to || year || month);

  // 当前生效的筛选条件（拼进每一页分页链接，刷新/分享可恢复）
  const baseQuery: Record<string, string> = {};
  if (qRaw.trim()) baseQuery.q = qRaw.trim();
  if (from) baseQuery.from = from;
  if (to) baseQuery.to = to;
  if (year) baseQuery.year = year;
  if (month) baseQuery.month = month;

  const controlsState: HistoryQueryState = {
    q: qRaw,
    from,
    to,
    year,
    month,
  };

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-5 flex flex-col gap-4">
      {/* 页头 */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[22px] lg:text-[24px] font-bold text-[var(--color-text-primary)] mb-1">
            历史档案馆
          </h1>
          <p className="text-[13px] text-[var(--color-text-muted)] flex items-center gap-3 flex-wrap">
            <span className="inline-flex items-center gap-1.5">
              <Database size={13} />
              共 <span className="text-[var(--color-text-secondary)] font-medium tabular-nums">{facets.total}</span> 篇日报
            </span>
            {facets.earliest_date && facets.latest_date && (
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays size={13} />
                {formatDate(facets.earliest_date)} ~ {formatDate(facets.latest_date)}
              </span>
            )}
          </p>
        </div>
      </div>

      {/* 搜索与筛选 */}
      <SearchControls
        initial={controlsState}
        years={facets.years}
        monthsByYear={facets.monthsByYear}
      />

      {/* 结果摘要 */}
      <div className="flex items-center gap-2 text-[13px] text-[var(--color-text-muted)] flex-wrap">
        {keywords.length > 0 && (
          <span>
            搜索「<span className="text-[var(--color-accent-light)]">{keywords.join(" ")}</span>」
          </span>
        )}
        {from && <span>从 {from} 起</span>}
        {to && <span>至 {to} 止</span>}
        {year && <span>{year} 年</span>}
        {month && <span>{month} 月</span>}
        <span>
          {hasCondition ? `命中 ${total} 篇` : `共 ${total} 篇`}（第 ${page} / ${totalPages} 页）
        </span>
      </div>

      {/* 日报列表 */}
      {items.length > 0 ? (
        <div className="flex flex-col gap-3">
          {items.map((report) => {
            const snippet = keywords.length
              ? buildSnippet(report.report_markdown, keywords)
              : null;
            return (
              <Link
                key={report.id}
                href={`/report/${report.report_date}`}
                className="block glass-card p-5 group hover:border-[var(--color-border-glow)]"
              >
                <div className="flex items-start gap-4">
                  {/* 日期块 */}
                  <div className="shrink-0 w-[4.5rem] text-center rounded-lg bg-[var(--color-bg-card)] border border-[var(--color-border-subtle)] py-2">
                    <div className="text-lg font-bold text-[var(--color-text-primary)] tabular-nums leading-none">
                      {report.report_date.slice(8, 10)}
                    </div>
                    <div className="text-[11px] text-[var(--color-text-muted)] tabular-nums mt-1">
                      {report.report_date.slice(0, 7)}
                    </div>
                  </div>

                  <div className="min-w-0 flex-1">
                    <h3 className="text-[17px] font-semibold text-[var(--color-text-primary)] group-hover:text-[var(--color-accent-light)] transition-colors leading-snug">
                      {report.title}
                    </h3>

                    {snippet && <SearchSnippet segments={snippet} />}

                    <div className="flex items-center gap-x-4 gap-y-1 mt-2 text-[13px] text-[var(--color-text-muted)] flex-wrap">
                      <span>生成 {formatDateTime(report.generated_at)}</span>
                      {report.total_articles !== null && (
                        <span>收录文章 <span className="text-[var(--color-text-secondary)] tabular-nums">{report.total_articles}</span></span>
                      )}
                      {report.headline_count !== null && (
                        <span>重点头条 <span className="text-[var(--color-text-secondary)] tabular-nums">{report.headline_count}</span></span>
                      )}
                      {report.status && (
                        <span className={report.status === "success" ? "text-green-400" : "text-amber-400"}>
                          {report.status === "success" ? "已生成" : report.status}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="shrink-0 self-center hidden sm:flex items-center gap-1.5 text-[13px] text-[var(--color-text-muted)] group-hover:text-[var(--color-accent-light)] transition-colors">
                    查看完整报告
                    <ArrowRight size={15} />
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="glass-card p-10 text-center">
          {page > 1 ? (
            <>
              <p className="text-base text-[var(--color-text-secondary)] mb-1">当前页码超出范围</p>
              <p className="text-[13px] text-[var(--color-text-muted)] mb-5">
                共 {totalPages} 页，你访问的是第 {page} 页。
              </p>
              <Link
                href={`/history${Object.keys(baseQuery).length ? `?${new URLSearchParams(baseQuery).toString()}` : ""}`}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-accent)] text-white text-sm hover:opacity-90 transition-opacity"
              >
                回到第 1 页
              </Link>
            </>
          ) : hasCondition ? (
            <>
              <SearchX size={28} className="text-[var(--color-text-muted)] mx-auto mb-3" />
              <p className="text-base text-[var(--color-text-secondary)] mb-1">未找到匹配的日报</p>
              <p className="text-[13px] text-[var(--color-text-muted)]">
                试试更换关键词，或放宽日期 / 年月筛选条件。
              </p>
            </>
          ) : (
            <>
              <FileText size={28} className="text-[var(--color-text-muted)] mx-auto mb-3" />
              <p className="text-base text-[var(--color-text-secondary)]">暂无历史日报</p>
              <p className="text-[13px] text-[var(--color-text-muted)] mt-1">
                系统生成日报后会自动出现在这里。
              </p>
            </>
          )}
        </div>
      )}

      {/* 分页（保留全部筛选条件） */}
      <Pagination page={page} totalPages={totalPages} baseQuery={baseQuery} />
    </div>
  );
}
