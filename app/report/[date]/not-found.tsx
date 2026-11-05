import Link from "next/link";
import { FileQuestion, ArrowLeft } from "lucide-react";

export default function ReportNotFound() {
  return (
    <div className="px-4 sm:px-6 py-16 max-w-2xl mx-auto">
      <div className="glass-card p-8 text-center">
        <div className="w-14 h-14 rounded-2xl bg-[var(--color-bg-card)] border border-[var(--color-border-subtle)] flex items-center justify-center mx-auto mb-4">
          <FileQuestion size={26} className="text-[var(--color-text-muted)]" />
        </div>
        <h1 className="text-lg font-semibold text-[var(--color-text-primary)] mb-2">
          未找到该日期的报告
        </h1>
        <p className="text-sm text-[var(--color-text-secondary)] mb-6">
          数据库中不存在这一天的日报，可能是尚未生成或日期有误。
        </p>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm bg-[var(--color-accent)] text-white hover:opacity-90 transition-opacity"
        >
          <ArrowLeft size={14} />
          返回今日情报
        </Link>
      </div>
    </div>
  );
}
