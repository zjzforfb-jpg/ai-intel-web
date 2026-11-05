import { getReportByDate, getAdjacentReports } from "@/lib/db";
import type { ReportRow, AdjacentReport } from "@/lib/db";
import { formatDateTime, formatDate } from "@/lib/format";
import { notFound } from "next/navigation";
import { ReportView } from "@/components/ReportView";
import { DbErrorState } from "@/components/DbErrorState";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ date: string }>;
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
