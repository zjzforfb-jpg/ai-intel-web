import { getLatestReport, getStats } from "@/lib/db";
import { parseReport } from "@/lib/markdown-parser";
import { formatDateTime, formatDate, todayStr } from "@/lib/format";
import { SectionPanel } from "@/components/SectionPanel";
import { HeadlineCard } from "@/components/HeadlineCard";
import { TrendCard } from "@/components/TrendCard";
import { OpportunityCard } from "@/components/OpportunityCard";
import { CoreJudgmentCard } from "@/components/CoreJudgmentCard";
import { DbErrorState } from "@/components/DbErrorState";
import { Flame, TrendingUp, Target, BookOpen, ArrowRight, Inbox } from "lucide-react";
import Link from "next/link";

// 首页只读、无写后回显，日报一天只变一次（n8n 08:30 出报）。
// 缓存 5 分钟：足够快，且"今日报告"标签最多滞后 5 分钟，可接受。
// 注意：不能用 revalidateTag —— 数据是 n8n 直接写库的，Next 侧收不到失效信号。
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
      <div className="flex items-center justify-center min-h-[calc(100vh-60px)] px-6">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 rounded-2xl bg-[var(--color-bg-card)] flex items-center justify-center mx-auto mb-4 border border-[var(--color-border-subtle)]">
            <Inbox size={28} className="text-[var(--color-text-muted)]" />
          </div>
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-2">
            今日暂无情报报告
          </h2>
          <p className="text-sm text-[var(--color-text-muted)] mb-6">
            系统尚未生成今日报告，请稍后再来查看。
          </p>
          {stats.total_reports > 0 && stats.latest_date && (
            <Link
              href={`/report/${stats.latest_date}`}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-accent)] text-white text-sm hover:opacity-90 transition-opacity"
            >
              查看最近一期报告
              <ArrowRight size={14} />
            </Link>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-4 flex flex-col gap-4 lg:h-[calc(100vh-59px)] lg:overflow-hidden">
      {/* 第一行通栏：今日核心判断（含统计徽章） */}
      <CoreJudgmentCard
        items={parsed?.coreJudgments ?? []}
        stats={[
          { label: "文章", value: report.total_articles },
          { label: "头条", value: report.headline_count },
          { label: "趋势", value: parsed?.trends.length ?? null },
          { label: "机会", value: parsed?.opportunities.length ?? null },
        ]}
        meta={`报告 ${formatDate(report.report_date)} · 生成 ${formatDateTime(report.generated_at)}${report.status ? ` · ${report.status === "success" ? "已生成" : report.status}` : ""} · ${isTodayReport ? "今日报告" : "最近报告"}`}
      />

      {/* 三大板块：占满剩余空间，等高、内部滚动 */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr_1fr] gap-4 lg:gap-5 flex-1 min-h-0">
        {/* 1. 今日 AI 头条 */}
        <SectionPanel
          title="今日 AI 头条"
          count={parsed?.headlines.length ?? null}
          dotColor="#f97316"
          icon={<Flame size={20} />}
        >
          {parsed && parsed.headlines.length > 0 ? (
            parsed.headlines.map((item) => <HeadlineCard key={item.index} item={item} />)
          ) : (
            <p className="text-base text-[var(--color-text-muted)] px-1 py-2">
              暂不可解析，请通过完整报告查看。
            </p>
          )}
        </SectionPanel>

        {/* 2. 今日趋势 */}
        <SectionPanel
          title="今日趋势"
          count={parsed?.trends.length ?? null}
          dotColor="#a855f7"
          icon={<TrendingUp size={20} />}
        >
          {parsed && parsed.trends.length > 0 ? (
            parsed.trends.map((item) => <TrendCard key={item.index} item={item} />)
          ) : (
            <p className="text-base text-[var(--color-text-muted)] px-1 py-2">
              暂不可解析，请通过完整报告查看。
            </p>
          )}
        </SectionPanel>

        {/* 3. 商业机会 */}
        <SectionPanel
          title="商业机会"
          count={parsed?.opportunities.length ?? null}
          dotColor="#10b981"
          icon={<Target size={20} />}
        >
          {parsed && parsed.opportunities.length > 0 ? (
            parsed.opportunities.map((item) => (
              <OpportunityCard key={item.index} item={item} />
            ))
          ) : (
            <p className="text-base text-[var(--color-text-muted)] px-1 py-2">
              暂不可解析，请通过完整报告查看。
            </p>
          )}
        </SectionPanel>
      </div>

      {/* 收底：完整日报入口 */}
      <Link
        href={`/report/${report.report_date}`}
        className="shrink-0 glass-card px-5 py-3 flex items-center justify-between group hover:border-[var(--color-border-glow)]"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-500/20 to-blue-500/20 flex items-center justify-center shrink-0">
            <BookOpen size={19} className="text-indigo-300" />
          </div>
          <span className="text-[17px] font-semibold text-[var(--color-text-primary)] group-hover:text-[var(--color-accent-light)] transition-colors">
            阅读完整日报
          </span>
          <span className="text-[13px] text-[var(--color-text-muted)] truncate hidden sm:inline">
            包含全部章节、详细解读与明日重点关注
          </span>
        </div>
        <ArrowRight
          size={20}
          className="text-[var(--color-text-muted)] group-hover:text-[var(--color-accent-light)] transition-colors shrink-0"
        />
      </Link>
    </div>
  );
}
