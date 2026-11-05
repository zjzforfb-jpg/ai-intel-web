import { listReports } from "@/lib/db";
import { DbErrorState } from "@/components/DbErrorState";

export const dynamic = "force-dynamic";

export default async function TrendsPage() {
  let total = 0;
  let dbError: string | null = null;
  try {
    const res = await listReports(1, 10);
    total = res.total;
  } catch (error) {
    dbError = error instanceof Error ? error.message : "数据库查询失败（未知错误）";
  }

  if (dbError) {
    return <DbErrorState title="无法读取趋势数据" detail={dbError} />;
  }

  return (
    <div className="px-4 sm:px-6 py-6 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--color-text-primary)] mb-1">
          趋势观察
        </h1>
        <p className="text-sm text-[var(--color-text-muted)]">
          基于 {total} 份报告的关键词与主题分析
        </p>
      </div>

      {total < 3 ? (
        <div className="glass-card p-8 text-center">
          <div className="w-12 h-12 rounded-xl bg-amber-500/10 flex items-center justify-center mx-auto mb-3 border border-amber-500/20">
            <span className="text-amber-400 text-xl">!</span>
          </div>
          <h3 className="text-base font-semibold text-[var(--color-text-primary)] mb-1">
            数据不足
          </h3>
          <p className="text-sm text-[var(--color-text-muted)] max-w-sm mx-auto">
            当前仅有 {total} 份报告，尚不足以形成可靠的趋势统计。
            请等待系统积累更多日报后再来查看。
          </p>
        </div>
      ) : (
        <div className="glass-card p-6">
          <p className="text-sm text-[var(--color-text-secondary)]">
            趋势分析功能将在数据积累充分后启用。
          </p>
        </div>
      )}
    </div>
  );
}
