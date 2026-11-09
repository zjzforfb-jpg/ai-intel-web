import { getReportByDate, getAdjacentReports } from "@/lib/db";
import type { ReportRow, AdjacentReport } from "@/lib/db";
import { formatDateTime, formatDate } from "@/lib/format";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ReportView } from "@/components/ReportView";
import { DbErrorState } from "@/components/DbErrorState";

// 单篇日报是纯阅读页，历史的日报几乎不再变动。缓存 5 分钟。
export const revalidate = 300;

// 动态段要显式声明 generateStaticParams 才会走「按需生成 + ISR 缓存」；
// 只写 revalidate 而不给这个函数，Next 会把整条路由当作纯动态渲染（no-store）。
//
// 这里刻意返回空数组：日报日期每天都在新增，构建期枚举没有意义，
// 而且会让构建依赖数据库（DB 没起就 build 失败）。
// 返回空 + 默认的 dynamicParams=true ⇒ 任意日期首次访问时生成，之后按 revalidate 命中缓存。
export function generateStaticParams(): Array<{ date: string }> {
  return [];
}

interface PageProps {
  params: Promise<{ date: string }>;
}

/** 用日期做标题，不额外查库（保证 metadata 不引入新的数据库往返） */
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { date } = await params;
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date);
  return {
    title: valid ? `${date} 日报 | 每日 AI 情报内参` : "日报 | 每日 AI 情报内参",
    description: "AI 行业每日情报日报：核心判断、重点头条、趋势与商业机会。",
  };
}

export default async function ReportPage({ params }: PageProps) {
  const { date } = await params;

  // 只接受严格的 YYYY-MM-DD，避免把非法日期直接带进 SQL
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    notFound();
  }

  let report: ReportRow | null = null;
  let dbError: string | null = null;

  try {
    report = await getReportByDate(date);
  } catch (error) {
    dbError = error instanceof Error ? error.message : "数据库查询失败（未知错误）";
  }

  if (dbError) {
    return <DbErrorState title="无法读取报告数据" detail={dbError} />;
  }

  if (!report) {
    notFound();
  }

  // 相邻日报查询失败不影响正文阅读，仅隐藏切换入口
  let prev: AdjacentReport | null = null;
  let next: AdjacentReport | null = null;
  try {
    const adjacent = await getAdjacentReports(date);
    prev = adjacent.prev;
    next = adjacent.next;
  } catch {
    prev = null;
    next = null;
  }

  return (
    <ReportView
      title={report.title}
      reportDate={report.report_date}
      reportDateLabel={formatDate(report.report_date)}
      generatedAt={formatDateTime(report.generated_at)}
      totalArticles={report.total_articles}
      headlineCount={report.headline_count}
      status={report.status}
      markdown={report.report_markdown}
      prev={prev}
      next={next}
    />
  );
}
