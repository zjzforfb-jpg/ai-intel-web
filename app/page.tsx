import { getLatestReport, getStats } from "@/lib/db";
import { parseReport } from "@/lib/markdown-parser";
import { formatDateTime, formatDate, todayStr } from "@/lib/format";
import { SectionPanel } from "@/components/SectionPanel";
import { HeadlineCard } from "@/components/HeadlineCard";
import { TrendCard } from "@/components/TrendCard";
import { OpportunityCard } from "@/components/OpportunityCard";
import { CoreJudgmentCard } from "@/components/CoreJudgmentCard";
import { DbErrorState } from "@/components/DbErrorState";
import { PageHeader, PageBody } from "@/components/PageHeader";
import { Flame, TrendingUp, Target, BookOpen, ArrowRight, Inbox } from "lucide-react";
import Link from "next/link";
import type { Metadata } from "next";

// 首页只读、无写后回显，日报一天只变一次（n8n 08:30 出报）。
// 缓存 5 分钟：足够快，且「今日报告」标签最多滞后 5 分钟，可接受。
// 注意：不能用 revalidateTag —— 数据是 n8n 直接写库的，Next 侧收不到失效信号。
export const metadata: Metadata = {
  title: "今日情报 | 每日 AI 情报内参",
  description: "当天 AI 行业情报总览：核心判断、重点头条、趋势与商业机会。",
};

export const revalidate = 300;

export default async function HomePage() {
  let report = null;
  let stats = null;
  let dbError: string | null = null;

  try {
    [report, stats] = await Promise.all([getLatestReport(), getStats()]);
  } catch (error) {
    dbError = error instanceof Error ? error.message : "数据库查询失败（未知错误）";
  }

  // 读取失败时明确报错，不伪装成「今日无报告」
  if (dbError || !stats) {
    return <DbErrorState title="无法读取情报数据" detail={dbError} />;
  }

  const parsed = parseReport(report?.report_markdown ?? null);
  const today = todayStr();
  const isTodayReport = report?.report_date === today;

  // 空状态
  if (!report) {
    return (
      <PageBody>
        <PageHeader title="今日情报" subtitle="当天 AI 行业情报总览" />
        <div className="empty-state">
          <Inbox size={28} className="text-[var(--color-text-muted)]" />
          <p className="text-[14px] text-[var(--color-text-secondary)]">
            今日暂无情报报告
          </p>
          <p className="text-[13px] text-[var(--color-text-muted)]">
            系统尚未生成今日报告，请稍后再来查看。
          </p>
          {stats.total_reports > 0 && stats.latest_date && (
            <Link href={`/report/${stats.latest_date}`} className="btn-primary mt-2">
              查看最近一期报告
              <ArrowRight size={14} />
            </Link>
          )}
        </div>
      </PageBody>
    );
  }

  const headlineCount = parsed?.headlines.length ?? 0;
  const trendCount = parsed?.trends.length ?? 0;
  const opportunityCount = parsed?.opportunities.length ?? 0;

  return (
    <PageBody>
      <PageHeader
        title="今日情报"
        subtitle={
          <>
            <span className="text-[var(--color-text-primary)] font-medium">
              {formatDate(report.report_date)}
            </span>
            <span>{isTodayReport ? "今日报告" : "最近报告"}</span>
            <span>生成于 {formatDateTime(report.generated_at)}</span>
            {report.status && (
              <span className="badge badge-success">
                {report.status === "success" ? "已生成" : report.status}
              </span>
            )}
          </>
        }
        actions={
          <Link href={`/report/${report.report_date}`} className="btn-primary">
            <BookOpen size={14} />
            阅读完整日报
          </Link>
        }
      />

      {/* ── 焦点区：今日核心判断（全页唯一强调，通栏） ────────────── */}
      <CoreJudgmentCard
        items={parsed?.coreJudgments ?? []}
        stats={[
          { label: "文章", value: report.total_articles },
          { label: "头条", value: report.headline_count },
          { label: "趋势", value: parsed?.trends.length ?? null },
          { label: "机会", value: parsed?.opportunities.length ?? null },
        ]}
        meta={`报告 ${formatDate(report.report_date)} · 生成 ${formatDateTime(report.generated_at)}`}
      />

      {/* ── 重点区：不对称 1.4 : 1 : 1 ──────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr_1fr] gap-4 items-start">
        <SectionPanel
          title="今日 AI 头条"
          count={parsed ? headlineCount : null}
          zone="headline"
          icon={<Flame size={16} />}
        >
          {parsed && headlineCount > 0 ? (
            parsed.headlines.map((item) => <HeadlineCard key={item.index} item={item} />)
          ) : (
            <p className="text-[13px] text-[var(--color-text-muted)]">
              暂不可解析，请通过完整报告查看。
            </p>
          )}
        </SectionPanel>

        <SectionPanel
          title="今日趋势"
          count={parsed ? trendCount : null}
          zone="trend"
          icon={<TrendingUp size={16} />}
        >
          {parsed && trendCount > 0 ? (
            parsed.trends.map((item) => <TrendCard key={item.index} item={item} />)
          ) : (
            <p className="text-[13px] text-[var(--color-text-muted)]">
              暂不可解析，请通过完整报告查看。
            </p>
          )}
        </SectionPanel>

        <SectionPanel
          title="商业机会"
          count={parsed ? opportunityCount : null}
          zone="opportunity"
          icon={<Target size={16} />}
        >
          {parsed && opportunityCount > 0 ? (
            parsed.opportunities.map((item) => (
              <OpportunityCard key={item.index} item={item} />
            ))
          ) : (
            <p className="text-[13px] text-[var(--color-text-muted)]">
              暂不可解析，请通过完整报告查看。
            </p>
          )}
        </SectionPanel>
      </div>

      {/* ── 收尾区：完整日报入口 ─────────────────────────────────── */}
      <Link
        href={`/report/${report.report_date}`}
        className="card-m flex items-center justify-between gap-4 group"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span
            className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
            style={{ color: "var(--color-accent-light)", background: "var(--color-accent-glow)" }}
            aria-hidden
          >
            <BookOpen size={17} />
          </span>
          <span className="text-[14px] font-semibold text-[var(--color-text-primary)] group-hover:text-[var(--color-accent-light)] transition-colors shrink-0">
            阅读完整日报
          </span>
          <span className="text-[12px] text-[var(--color-text-muted)] truncate hidden sm:inline">
            包含全部章节、详细解读与明日重点关注
          </span>
        </div>
        <ArrowRight
          size={18}
          className="text-[var(--color-text-muted)] group-hover:text-[var(--color-accent-light)] transition-colors shrink-0"
        />
      </Link>
    </PageBody>
  );
}
