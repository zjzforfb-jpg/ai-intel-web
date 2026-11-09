import Link from "next/link";
import { CalendarDays, Lightbulb, SearchX, Sparkles, Star, TrendingUp } from "lucide-react";
import { listIdeas, countIdeas, getIdeaStats } from "@/lib/ideas";
import { isIdeaStatus, IDEA_STATUSES, type IdeaRow, type IdeaStatus } from "@/lib/ideas-shared";
import { DbErrorState } from "@/components/DbErrorState";
import { PageHeader, PageBody } from "@/components/PageHeader";
import { ScoreHistogram } from "@/components/ideas/ScoreHistogram";
import { StatusBadge } from "@/components/ideas/StatusBadge";
import { CreateIdeaSection } from "./CreateIdeaSection";
import { IdeaListRow } from "./IdeaListRow";
import { dbHint } from "@/lib/config";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "短视频选题 | 每日 AI 情报内参",
  description: "从每日日报自动提取的短视频选题，含切入角度、素材来源与参考画面。",
};

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

/** 取查询参数的首个字符串值 */
function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

/** 按来源日报日期分组（日期倒序），组内保持 listIdeas 的评分排序 */
function groupByDate(items: IdeaRow[]): Array<{ date: string; items: IdeaRow[] }> {
  const groups: Array<{ date: string; items: IdeaRow[] }> = [];
  const byDate = new Map<string, IdeaRow[]>();
  for (const item of items) {
    let arr = byDate.get(item.report_date);
    if (!arr) {
      arr = [];
      byDate.set(item.report_date, arr);
      groups.push({ date: item.report_date, items: arr });
    }
    arr.push(item);
  }
  return groups;
}

/** 漏斗三段：待制作 → 已选用 → 已制作 */
const FUNNEL_STAGES: Array<{ status: IdeaStatus; label: string }> = [
  { status: "待制作", label: "待制作" },
  { status: "已选用", label: "已选用" },
  { status: "已制作", label: "已制作" },
];

export default async function IdeasPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;

  // 非法状态一律忽略（不把非法值传给数据库）
  const statusRaw = first(sp.status);
  const status: IdeaStatus | "" = isIdeaStatus(statusRaw) ? statusRaw : "";

  let list: IdeaRow[] | null = null;
  let total = 0;
  let stats: Awaited<ReturnType<typeof getIdeaStats>> | null = null;
  let dbError: string | null = null;

  try {
    [list, total, stats] = await Promise.all([
      listIdeas({ status: status || null }),
      countIdeas(),
      getIdeaStats(),
    ]);
  } catch (error) {
    dbError = error instanceof Error ? error.message : "数据库查询失败（未知错误）";
  }

  if (!list || !stats) {
    return (
      <DbErrorState
        title="无法读取选题"
        detail={dbError}
        hint={dbHint("any")}
      />
    );
  }

  const hasFilter = !!status;
  const groups = groupByDate(list);

  /** 构造状态筛选链接（状态空 = 全部） */
  function filterHref(s: IdeaStatus | ""): string {
    return s ? `/ideas?status=${encodeURIComponent(s)}` : "/ideas";
  }

  // 漏斗基数：不含「已放弃」
  const funnelBase = FUNNEL_STAGES.reduce((sum, st) => sum + stats.statusCounts[st.status], 0);
  const dailyMax = Math.max(1, ...stats.daily.map((d) => d.count));

  return (
    <PageBody>
      <PageHeader
        title="选题提取"
        subtitle={
          <>
            <span className="inline-flex items-center gap-1.5">
              <Sparkles size={13} />
              共
              <span className="text-[var(--color-text-secondary)] font-medium tabular-nums">
                {total}
              </span>
              条选题
            </span>
            {hasFilter && (
              <span>
                当前筛选命中
                <span className="text-[var(--color-text-secondary)] font-medium tabular-nums">
                  {list.length}
                </span>
                条
              </span>
            )}
            <span>从每日日报自动提取的短视频选题，含切入角度、素材来源与参考画面</span>
          </>
        }
      />

      {/* 新建选题：折叠态只占一行，展开后表单在下方铺开 */}
      <CreateIdeaSection />

      {/* ── 焦点区：选题态势（全页唯一强调） ─────────────────────── */}
      <section className="focus-zone flex flex-col gap-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-[16px] font-semibold text-[var(--color-text-primary)]">
            选题态势
          </h2>
          <span className="text-[11px] text-[var(--color-text-muted)]">
            漏斗基数 {funnelBase} 条（不含已放弃）· 高分 ≥ {stats.highScoreThreshold} 分
          </span>
        </div>

        {/* 漏斗 + 分布 + 关键指标：3 栏不等宽 */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* 漏斗 */}
          <div className="lg:col-span-5 flex flex-col gap-3">
            <div className="flex h-2.5 rounded-full overflow-hidden bg-[var(--color-bg-card-hover)]">
              {FUNNEL_STAGES.map((st, i) => {
                const count = stats.statusCounts[st.status];
                const pct = funnelBase > 0 ? (count / funnelBase) * 100 : 0;
                if (count === 0) return null;
                return (
                  <div
                    key={st.status}
                    className="h-full"
                    style={{
                      width: `${pct}%`,
                      background: `var(--color-status-${["todo", "picked", "made"][i]})`,
                    }}
                    title={`${st.label}：${count} 条（${pct.toFixed(0)}%）`}
                  />
                );
              })}
            </div>
            <ul className="flex flex-col gap-2">
              {FUNNEL_STAGES.map((st, i) => {
                const count = stats.statusCounts[st.status];
                const pct = funnelBase > 0 ? Math.round((count / funnelBase) * 100) : 0;
                return (
                  <li key={st.status} className="flex items-center gap-2.5">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ background: `var(--color-status-${["todo", "picked", "made"][i]})` }}
                      aria-hidden
                    />
                    <span className="text-[13px] text-[var(--color-text-secondary)] w-14 shrink-0">
                      {st.label}
                    </span>
                    <span className="text-[14px] font-semibold text-[var(--color-text-primary)] tabular-nums w-8 shrink-0">
                      {count}
                    </span>
                    <span className="text-[11px] text-[var(--color-text-muted)] tabular-nums">
                      {pct}%
                    </span>
                    <span className="flex-1 h-px bg-[var(--color-border-subtle)]" aria-hidden />
                    {i > 0 && (
                      <span className="text-[11px] text-[var(--color-text-muted)] tabular-nums shrink-0">
                        转化 {stats.statusCounts[FUNNEL_STAGES[i - 1].status] > 0
                          ? Math.round(
                              (count / stats.statusCounts[FUNNEL_STAGES[i - 1].status]) * 100
                            )
                          : 0}
                        %
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          {/* 价值分分布 */}
          <div className="lg:col-span-4 flex flex-col gap-2">
            <p className="text-[12px] font-medium text-[var(--color-text-secondary)]">
              价值分分布
            </p>
            <ScoreHistogram
              histogram={stats.scoreHistogram}
              threshold={stats.highScoreThreshold}
              total={stats.scoredCount}
            />
          </div>

          {/* 关键指标 */}
          <div className="lg:col-span-3 grid grid-cols-2 gap-3 content-start">
            <div className="card-s">
              <p className="text-[11px] text-[var(--color-text-muted)] mb-1">平均分</p>
              <p className="text-[24px] font-bold text-[var(--color-text-primary)] tnum leading-none">
                {stats.avgScore != null ? stats.avgScore.toFixed(1) : "—"}
              </p>
              <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
                {stats.scoredCount} 条已评分
              </p>
            </div>
            <div className="card-s">
              <p className="text-[11px] text-[var(--color-text-muted)] mb-1">高分库存</p>
              <p className="text-[24px] font-bold text-[var(--color-accent-light)] tnum leading-none">
                {stats.highScoreCount}
              </p>
              <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
                ≥ {stats.highScoreThreshold} 分可做
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── 重点区 2:1：高价值待处理 + 右栏 ─────────────────────── */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* 左：Top3 高价值待处理 */}
        <div className="lg:col-span-2 card-l flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="text-[16px] font-semibold text-[var(--color-text-primary)] flex items-center gap-2">
              <Star size={15} style={{ color: "var(--color-warning)" }} />
              高价值待处理
            </h2>
            <span className="text-[11px] text-[var(--color-text-muted)]">
              待制作 + 已选用，按价值分排序取前 3
            </span>
          </div>

          {stats.pendingTop.length > 0 ? (
            <ul className="flex flex-col divide-y divide-[var(--color-border-subtle)]">
              {stats.pendingTop.map((item) => (
                <li key={item.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] font-medium text-[var(--color-text-primary)] leading-snug [overflow-wrap:anywhere]">
                        {item.title}
                      </p>
                      {item.angle && (
                        <p className="mt-1 text-[12px] text-[var(--color-text-muted)] line-clamp-1 [overflow-wrap:anywhere]">
                          {item.angle}
                        </p>
                      )}
                      <div className="mt-2 flex items-center gap-2">
                        <StatusBadge status={item.status} />
                        <span className="text-[11px] text-[var(--color-text-muted)]">
                          {item.report_date}
                        </span>
                      </div>
                    </div>
                    <div className="shrink-0 flex items-center gap-2">
                      {item.value_score != null && (
                        <span
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-medium tnum"
                          style={{
                            color: "var(--color-warning)",
                            borderColor: "color-mix(in srgb, var(--color-warning) 35%, transparent)",
                            background: "color-mix(in srgb, var(--color-warning) 10%, transparent)",
                          }}
                        >
                          <Star size={10} />
                          {item.value_score}
                        </span>
                      )}
                      <a href={`#idea-${item.id}`} className="btn-secondary">
                        定位
                      </a>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-[var(--color-text-muted)] py-4 text-center">
              暂无带评分的待处理选题
            </p>
          )}
        </div>

        {/* 右栏 300px：本周节奏 + 收纳区 */}
        <div className="flex flex-col gap-4">
          <div className="card-m flex flex-col gap-3">
            <h3 className="text-[14px] font-semibold text-[var(--color-text-primary)] flex items-center gap-2">
              <TrendingUp size={14} style={{ color: "var(--color-accent-light)" }} />
              本周节奏
            </h3>
            {stats.daily.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {stats.daily.map((d) => (
                  <li key={d.report_date} className="flex items-center gap-2.5">
                    <span className="text-[11px] text-[var(--color-text-muted)] tabular-nums w-[74px] shrink-0">
                      {d.report_date.slice(5)}
                    </span>
                    <span className="flex-1 h-1.5 rounded-full bg-[var(--color-bg-card-hover)] overflow-hidden">
                      <span
                        className="block h-full rounded-full"
                        style={{
                          width: `${(d.count / dailyMax) * 100}%`,
                          background: "var(--color-accent)",
                        }}
                      />
                    </span>
                    <span className="text-[12px] text-[var(--color-text-secondary)] tabular-nums w-5 text-right shrink-0">
                      {d.count}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[12px] text-[var(--color-text-muted)]">暂无数据</p>
            )}
          </div>

          {/* 收纳区：默认折叠，避免干扰主视线 */}
          <details className="card-m">
            <summary className="text-[14px] font-semibold text-[var(--color-text-primary)] cursor-pointer select-none list-none flex items-center justify-between gap-2">
              收纳区
              <span className="text-[11px] font-normal text-[var(--color-text-muted)]">
                {stats.droppedCount + stats.lowScoreCount} 条
              </span>
            </summary>
            <div className="mt-3 pt-3 border-t border-[var(--color-border-subtle)] flex flex-col gap-2">
              <Link
                href="/ideas?status=%E5%B7%B2%E6%94%BE%E5%BC%83"
                className="flex items-center justify-between text-[13px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
              >
                <span>已放弃</span>
                <span className="tabular-nums text-[var(--color-text-muted)]">
                  {stats.droppedCount}
                </span>
              </Link>
              <div className="flex items-center justify-between text-[13px] text-[var(--color-text-secondary)]">
                <span>低分未处理（≤ 3 分）</span>
                <span className="tabular-nums text-[var(--color-text-muted)]">
                  {stats.lowScoreCount}
                </span>
              </div>
            </div>
          </details>
        </div>
      </section>

      {/* ── 常规区：筛选 + 列表流 ──────────────────────────────── */}
      <section className="flex flex-col gap-4">
        <div className="flex items-center gap-2 flex-wrap">
          {(["", ...IDEA_STATUSES] as const).map((s) => {
            const active = s === status;
            return (
              <Link
                key={s || "all"}
                href={filterHref(s)}
                aria-pressed={active}
                className={`chip ${active ? "chip-active" : ""}`}
              >
                {s || "全部"}
              </Link>
            );
          })}
        </div>

        {groups.length > 0 ? (
          groups.map((group) => (
            <div key={group.date} className="card-l flex flex-col gap-1">
              <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--color-text-secondary)] tabular-nums mb-1">
                <CalendarDays size={13} />
                {group.date}
                <span className="text-[var(--color-text-muted)] font-normal">
                  （{group.items.length} 条）
                </span>
              </h2>
              {group.items.map((item) => (
                <IdeaListRow key={item.id} idea={item} />
              ))}
            </div>
          ))
        ) : hasFilter ? (
          <div className="empty-state">
            <SearchX size={26} className="text-[var(--color-text-muted)]" />
            <p className="text-[14px] text-[var(--color-text-secondary)]">
              没有符合筛选条件的选题
            </p>
            <p className="text-[13px] text-[var(--color-text-muted)]">
              试试更换状态条件，或查看全部选题。
            </p>
            <Link href="/ideas" className="btn-secondary mt-1">
              查看全部
            </Link>
          </div>
        ) : (
          <div className="empty-state">
            <Lightbulb size={26} className="text-[var(--color-text-muted)]" />
            <p className="text-[14px] text-[var(--color-text-secondary)]">还没有选题</p>
            <p className="text-[13px] text-[var(--color-text-muted)] max-w-md">
              n8n 每日日报生成后会自动提取 3-5 条选题写入这里，也可以点上方「新建选题」手动录入。
            </p>
          </div>
        )}
      </section>
    </PageBody>
  );
}
