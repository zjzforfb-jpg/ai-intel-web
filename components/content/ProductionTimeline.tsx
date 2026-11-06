import { CheckCircle2, Circle, Clock } from "lucide-react";
import { formatDateTime } from "@/lib/format";
import {
  PRODUCTION_STATUSES,
  type ProductionStatus,
} from "@/lib/content-projects-shared";

interface ProductionTimelineProps {
  current: ProductionStatus;
  exportedAt: string | null;
  exportPath: string | null;
}

/** 生产状态时间线：未导出 → 已导出待生产 → 已导入脚本 → 已出分镜 → 已完成 */
export function ProductionTimeline({ current, exportedAt, exportPath }: ProductionTimelineProps) {
  const currentIndex = PRODUCTION_STATUSES.indexOf(current);

  return (
    <section className="glass-card p-5 flex flex-col gap-3">
      <h2 className="text-[13px] font-medium text-[var(--color-text-muted)] tracking-wider">
        生产进度
      </h2>

      <ol className="flex flex-col gap-0">
        {PRODUCTION_STATUSES.map((step, i) => {
          const done = i < currentIndex;
          const active = i === currentIndex;
          const passed = i <= currentIndex;
          return (
            <li key={step} className="flex gap-2.5">
              <div className="flex flex-col items-center">
                {passed ? (
                  <CheckCircle2
                    size={14}
                    className={active ? "text-[var(--color-accent-light)]" : "text-[var(--color-success)]"}
                  />
                ) : (
                  <Circle size={14} className="text-[var(--color-text-muted)]" />
                )}
                {i < PRODUCTION_STATUSES.length - 1 && (
                  <span
                    className={`w-px flex-1 min-h-4 my-0.5 ${
                      i < currentIndex ? "bg-[var(--color-success)]/40" : "bg-[var(--color-border-subtle)]"
                    }`}
                  />
                )}
              </div>
              <div className={`pb-3 ${i === PRODUCTION_STATUSES.length - 1 ? "pb-0" : ""}`}>
                <div
                  className={`text-[13px] leading-tight ${
                    active
                      ? "text-[var(--color-accent-light)] font-medium"
                      : passed
                        ? "text-[var(--color-text-secondary)]"
                        : "text-[var(--color-text-muted)]"
                  }`}
                >
                  {step}
                  {done && <span className="text-[11px] text-[var(--color-text-muted)] ml-1">已完成</span>}
                </div>
                {step === "已导出待生产" && exportedAt && (
                  <div className="text-[11px] text-[var(--color-text-muted)] mt-1 inline-flex items-center gap-1">
                    <Clock size={10} />
                    {formatDateTime(exportedAt)}
                    {exportPath && <span className="font-mono">· {exportPath}</span>}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      <p className="text-[12px] text-[var(--color-text-muted)] leading-relaxed pt-2 border-t border-[var(--color-border-subtle)]">
        后续状态需你手动回读后才会推进；平台无法感知本地文件变化。
      </p>
    </section>
  );
}
