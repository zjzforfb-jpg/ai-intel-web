"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Copy,
  Check,
  Printer,
} from "lucide-react";
import { ReportContent } from "@/components/ReportContent";
import { ReportToc } from "@/components/ReportToc";
import { ReadingProgress } from "@/components/ReadingProgress";
import { buildToc } from "@/lib/markdown-parser";

interface AdjacentItem {
  report_date: string;
  title: string;
}

interface ReportViewProps {
  title: string;
  /** ISO 日期 YYYY-MM-DD，用于路由跳转 */
  reportDate: string;
  /** 已格式化的展示日期 */
  reportDateLabel: string;
  generatedAt: string;
  totalArticles: number | null;
  headlineCount: number | null;
  status: string | null;
  markdown: string | null;
  prev: AdjacentItem | null;
  next: AdjacentItem | null;
}

export function ReportView({
  title,
  reportDate,
  reportDateLabel,
  generatedAt,
  totalArticles,
  headlineCount,
  status,
  markdown,
  prev,
  next,
}: ReportViewProps) {
  const [copied, setCopied] = useState(false);
  const toc = useMemo(() => buildToc(markdown), [markdown]);

  async function handleCopy() {
    if (!markdown) return;
    try {
      // 只复制数据库中的原始 Markdown 正文，不含任何页面 UI 文本
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* 剪贴板不可用时保持静默，页面内容不受影响 */
    }
  }

  return (
    <div className="px-4 sm:px-6 py-6 mx-auto w-full max-w-6xl">
      <ReadingProgress />

      {/* 工具栏 */}
      <div data-print-hide className="flex items-center justify-between gap-3 flex-wrap mb-5">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-[15px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
        >
          <ArrowLeft size={17} />
          返回首页
        </Link>

        <div className="flex items-center gap-2 flex-wrap">
          {/* 相邻日报（仅在真实存在时出现） */}
          {prev && (
            <Link
              href={`/report/${prev.report_date}`}
              title={`上一篇：${prev.title}`}
              className="inline-flex items-center gap-1 px-3 py-2 rounded-lg text-[13px] bg-[var(--color-bg-card)] border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-glow)] hover:text-[var(--color-text-primary)] transition-all"
            >
              <ChevronLeft size={15} />
              上一篇
            </Link>
          )}
          {next && (
            <Link
              href={`/report/${next.report_date}`}
              title={`下一篇：${next.title}`}
              className="inline-flex items-center gap-1 px-3 py-2 rounded-lg text-[13px] bg-[var(--color-bg-card)] border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-glow)] hover:text-[var(--color-text-primary)] transition-all"
            >
              下一篇
              <ChevronRight size={15} />
            </Link>
          )}

          <button
            onClick={handleCopy}
            disabled={!markdown}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[13px] bg-[var(--color-bg-card)] border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-glow)] hover:text-[var(--color-text-primary)] transition-all disabled:opacity-40"
          >
            {copied ? <Check size={15} className="text-green-400" /> : <Copy size={15} />}
            {copied ? "已复制全文" : "复制全文"}
          </button>
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[13px] bg-[var(--color-bg-card)] border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-glow)] hover:text-[var(--color-text-primary)] transition-all"
          >
            <Printer size={15} />
            打印
          </button>
        </div>
      </div>

      {/* 报告头部 */}
      <div className="glass-card p-5 sm:p-7 mb-6 relative overflow-hidden">
        <div
          className="absolute top-0 inset-x-0 h-[3px]"
          style={{
            background:
              "linear-gradient(90deg, #6366f1 0%, #818cf8 35%, rgba(129,140,248,0.25) 70%, transparent 100%)",
          }}
          aria-hidden
        />
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          {status && (
            <span
              className={`inline-flex items-center px-3 py-1 rounded-full text-xs border print:bg-transparent print:border-neutral-400 ${
                status === "success"
                  ? "bg-green-500/10 text-green-400 border-green-500/20"
                  : "bg-amber-500/10 text-amber-400 border-amber-500/20"
              }`}
            >
              {status === "success" ? "已生成" : status}
            </span>
          )}
          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs bg-[var(--color-bg-card)] text-[var(--color-text-secondary)] border border-[var(--color-border-subtle)] print:bg-transparent print:border-neutral-400">
            {toc.length} 个章节
          </span>
        </div>
        <h1 className="text-[22px] sm:text-[26px] lg:text-[28px] font-bold text-[var(--color-text-primary)] mb-4 leading-snug">
          {title}
        </h1>
        <dl className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[14px] text-[var(--color-text-muted)]">
          <div className="flex items-center gap-1.5">
            <dt>报告日期</dt>
            <dd className="text-[var(--color-text-secondary)] tabular-nums">{reportDateLabel}</dd>
          </div>
          <div className="flex items-center gap-1.5">
            <dt>生成时间</dt>
            <dd className="text-[var(--color-text-secondary)] tabular-nums">{generatedAt}</dd>
          </div>
          {totalArticles !== null && (
            <div className="flex items-center gap-1.5">
              <dt>收录文章</dt>
              <dd className="text-[var(--color-text-secondary)] tabular-nums">{totalArticles}</dd>
            </div>
          )}
          {headlineCount !== null && (
            <div className="flex items-center gap-1.5">
              <dt>重点头条</dt>
              <dd className="text-[var(--color-text-secondary)] tabular-nums">{headlineCount}</dd>
            </div>
          )}
        </dl>
      </div>

      {/* 双栏：目录 + 正文 */}
      <div className="flex flex-col lg:flex-row lg:items-start gap-4 lg:gap-8">
        <ReportToc items={toc} />
        <div className="flex-1 min-w-0">
          <ReportContent markdown={markdown} toc={toc} />

          {/* 底部相邻日报 */}
          {(prev || next) && (
            <nav data-print-hide className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
              {prev ? (
                <Link
                  href={`/report/${prev.report_date}`}
                  className="glass-card p-5 group hover:border-[var(--color-border-glow)] block"
                >
                  <div className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)] mb-1.5">
                    <ChevronLeft size={13} />
                    上一篇（{prev.report_date}）
                  </div>
                  <div className="text-[15px] text-[var(--color-text-primary)] group-hover:text-[var(--color-accent-light)] transition-colors line-clamp-2">
                    {prev.title}
                  </div>
                </Link>
              ) : (
                <div className="hidden sm:block" />
              )}
              {next && (
                <Link
                  href={`/report/${next.report_date}`}
                  className="glass-card p-5 group hover:border-[var(--color-border-glow)] block sm:text-right"
                >
                  <div className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)] mb-1.5 sm:justify-end">
                    下一篇（{next.report_date}）
                    <ChevronRight size={13} />
                  </div>
                  <div className="text-[15px] text-[var(--color-text-primary)] group-hover:text-[var(--color-accent-light)] transition-colors line-clamp-2">
                    {next.title}
                  </div>
                </Link>
              )}
            </nav>
          )}

          <div data-print-hide className="mt-6">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-[15px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
            >
              <ArrowLeft size={16} />
              返回今日情报
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
