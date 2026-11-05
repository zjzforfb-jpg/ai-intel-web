// 趋势观察中心：热点统计 + 关键词频次时间序列 + 历史趋势图表 + 持续热点
// 服务端组件：searchParams 在 Next 16 是 Promise，必须 await；筛选状态进 URL query
import Link from "next/link";
import {
  BarChart3,
  LineChart,
  Hash,
  Repeat,
  Database,
  CalendarDays,
  CalendarX2,
  Info,
  TrendingUp,
} from "lucide-react";
import {
  getTrendsData,
  resolveTrendRange,
  type KeywordStat,
} from "@/lib/trends";
import { DbErrorState } from "@/components/DbErrorState";
import { SERIES_COLORS } from "@/components/trends/chart-colors";
import { TrendChart } from "@/components/trends/TrendChart";
import { KeywordList } from "@/components/trends/KeywordList";
import { PersistentHotspots } from "@/components/trends/PersistentHotspots";
import { StatCards } from "@/components/trends/StatCards";
import { RangeFilter } from "@/components/trends/RangeFilter";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

function SectionTitle({
  icon: Icon,
  title,
  desc,
  color,
}: {
  icon: typeof Hash;
  title: string;
  desc: string;
  color: string;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
        style={{ background: `${color}1a`, color }}
      >
        <Icon size={17} />
      </div>
      <div className="min-w-0">
        <h2 className="text-[17px] font-semibold text-[var(--color-text-primary)] leading-snug">
          {title}
        </h2>
        <p className="text-[13px] text-[var(--color-text-muted)] mt-0.5 leading-relaxed">
          {desc}
        </p>
      </div>
    </div>
  );
}

export default async function TrendsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const range = resolveTrendRange(sp);

  let payload: Awaited<ReturnType<typeof getTrendsData>> | null = null;
  let dbError: string | null = null;
  try {
    payload = await getTrendsData(range);
  } catch (error) {
    dbError =
      error instanceof Error ? error.message : "数据库查询失败（未知错误）";
  }

  if (dbError || !payload) {
    return <DbErrorState title="无法读取趋势数据" detail={dbError} />;
  }

  const { data, catalog } = payload;
  const dates = data.daily.map((d) => d.date);

  const barSeries = [
    {
      key: "articles",
      name: "收录文章",
      color: SERIES_COLORS[0],
      values: data.daily.map((d) => d.totalArticles),
    },
    {
      key: "headlines",
      name: "重点头条",
      color: SERIES_COLORS[1],
      values: data.daily.map((d) => d.headlineCount),
    },
  ];

  const lineSeries = data.chartKeywords.map((k: KeywordStat, i: number) => ({
    key: k.term,
    name: k.term,
    color: SERIES_COLORS[i % SERIES_COLORS.length],
    values: k.series.map((p) => p.count),
  }));

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-5 flex flex-col gap-4 max-w-6xl">
      {/* 页头 */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[22px] lg:text-[24px] font-bold text-[var(--color-text-primary)] mb-1">
            趋势观察
          </h1>
          <p className="text-[13px] text-[var(--color-text-muted)] flex items-center gap-3 flex-wrap">
            <span className="inline-flex items-center gap-1.5">
              <TrendingUp size={13} />
              {range.label}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Database size={13} />
              全库共{" "}
              <span className="text-[var(--color-text-secondary)] font-medium tabular-nums">
                {catalog.totalReports}
              </span>{" "}
              篇日报
              {catalog.earliest && catalog.latest && (
                <>
                  （{catalog.earliest} ~ {catalog.latest}）
                </>
              )}
            </span>
          </p>
        </div>
      </div>

      {/* 时间范围筛选（状态在 URL query） */}
      <RangeFilter
        initial={{
          mode: range.mode,
          from: range.from ?? "",
          to: range.to ?? "",
        }}
        dataEarliest={catalog.earliest}
        dataLatest={catalog.latest}
      />

      {/* 统计概览 */}
      <StatCards
        reports={data.totals.reports}
        articles={data.totals.articles}
        headlines={data.totals.headlines}
        keywordCount={data.totals.keywordCount}
      />

      {data.totals.reports === 0 ? (
        /* 范围内无日报：空态 + 引导 */
        <div className="glass-card p-10 text-center">
          <CalendarX2
            size={28}
            className="text-[var(--color-text-muted)] mx-auto mb-3"
          />
          <p className="text-base text-[var(--color-text-secondary)] mb-1">
            该时间范围内没有日报
          </p>
          <p className="text-[13px] text-[var(--color-text-muted)] max-w-md mx-auto leading-relaxed">
            {catalog.earliest && catalog.latest
              ? `数据库中现有日报的时间范围是 ${catalog.earliest} ~ ${catalog.latest}（共 ${catalog.totalReports} 篇）。可调整时间范围，或查看全部数据。`
              : "系统生成日报后，趋势统计会自动出现在这里。"}
          </p>
          <Link
            href="/trends"
            className="inline-flex items-center gap-2 px-4 py-2 mt-5 rounded-lg bg-[var(--color-accent)] text-white text-sm hover:opacity-90 transition-opacity"
          >
            查看全部数据
          </Link>
        </div>
      ) : (
        <>
          {/* 数据稀少提示（不阻断展示，不造数） */}
          {data.totals.reports < 3 && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 flex items-start gap-2.5">
              <Info size={16} className="text-amber-400 shrink-0 mt-0.5" />
              <p className="text-[13px] text-amber-200/90 leading-relaxed">
                当前范围内仅有 {data.totals.reports} 篇日报，统计代表性有限；
                图表按真实数据绘制（数据点少时只呈现单点/单柱），
                随日报积累，趋势与持续热点会自动完善。
              </p>
            </div>
          )}

          {/* 产出节奏 */}
          <section className="glass-card p-4 lg:p-5 flex flex-col gap-3">
            <SectionTitle
              icon={BarChart3}
              title="产出节奏"
              desc="每日报收录文章数与重点头条数（来自日报元数据 total_articles / headline_count）"
              color="#818cf8"
            />
            <TrendChart
              type="bar"
              dates={dates}
              series={barSeries}
              yLabel="篇数"
              height={300}
            />
          </section>

          {/* 热点统计 */}
          <section className="glass-card p-4 lg:p-5 flex flex-col gap-3">
            <SectionTitle
              icon={Hash}
              title="热点统计"
              desc="对日报标题与正文做关键词频次统计：热度 = 标题提及 ×3 + 正文提及；中文按 2~6 字词片统计并做包含剪枝。点击词条可在历史档案馆检索原文。"
              color="#c084fc"
            />
            {data.keywords.length > 0 ? (
              <KeywordList
                keywords={data.keywords}
                colors={SERIES_COLORS}
              />
            ) : (
              <div className="rounded-xl border border-[var(--color-border-subtle)] p-8 text-center">
                <Hash
                  size={24}
                  className="text-[var(--color-text-muted)] mx-auto mb-2.5"
                />
                <p className="text-[15px] text-[var(--color-text-secondary)] mb-1">
                  暂未统计出有效热词
                </p>
                <p className="text-[13px] text-[var(--color-text-muted)]">
                  当前范围内日报正文过少，待数据积累后自动生成热词榜。
                </p>
              </div>
            )}
          </section>

          {/* 关键词频次趋势 */}
          <section className="glass-card p-4 lg:p-5 flex flex-col gap-3">
            <SectionTitle
              icon={LineChart}
              title="关键词频次趋势"
              desc="Top 热词在每日报中出现次数（标题+正文）随时间的变化"
              color="#34d399"
            />
            {dates.length >= 2 && lineSeries.length > 0 ? (
              <TrendChart
                type="line"
                dates={dates}
                series={lineSeries}
                yLabel="出现次数"
                height={300}
              />
            ) : (
              <div className="rounded-xl border border-[var(--color-border-subtle)] p-8 text-center">
                <LineChart
                  size={24}
                  className="text-[var(--color-text-muted)] mx-auto mb-2.5"
                />
                <p className="text-[15px] text-[var(--color-text-secondary)] mb-1">
                  报告日不足，暂无法形成时间趋势
                </p>
                <p className="text-[13px] text-[var(--color-text-muted)]">
                  {dates.length === 1
                    ? "当前范围内只有 1 个报告日，频次趋势需要至少 2 个报告日的数据。"
                    : "当前范围内没有可用于趋势统计的报告日。"}
                  可放宽时间范围，或等待更多日报积累。
                </p>
              </div>
            )}
          </section>

          {/* 持续热点 */}
          <section className="glass-card p-4 lg:p-5 flex flex-col gap-3">
            <SectionTitle
              icon={Repeat}
              title="持续热点"
              desc="在 ≥2 个不同报告日的日报中反复出现的关键词/主题，按覆盖天数排序"
              color="#f59e0b"
            />
            <PersistentHotspots
              items={data.persistent}
              reportDays={data.totals.reports}
            />
          </section>
        </>
      )}

      {/* 口径说明 */}
      <p className="text-[13px] text-[var(--color-text-muted)] leading-relaxed flex items-start gap-1.5">
        <CalendarDays size={14} className="shrink-0 mt-0.5" />
        统计口径：全部结果来自真实日报（title + report_markdown）的词频统计，
        无数据时展示空态而不补造数据；「近 7 天 / 近 30 天」以今天为基准，
        「自定义」支持任意起止日期（起止颠倒自动交换）。
      </p>
    </div>
  );
}
