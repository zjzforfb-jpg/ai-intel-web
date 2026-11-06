"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, ClipboardCopy, Download, Loader2, Upload } from "lucide-react";

interface ExportPanelProps {
  projectId: number;
  productionStatus: string;
  exportedAt: string | null;
  warnings: string[];
}

const STEPS = [
  "点击上方「导出 production_input.json」，把文件下载到本机。",
  "在 AI_DIRECTOR_PROJECT 里新建一集目录（或使用现有项目），把文件放到该项目的 00_source/ 下。",
  "按该流水线既有流程推进：01_bible → 02_baseline → 03_assets → 04_director → 05_storyboards。",
  "跑完后，把 05_storyboards/storyboard.md 与 project_state.json 的结果整理成 JSON，粘贴到下方「回读生产结果」。",
];

/** 导出区：按钮 + JSON 预览 + 复制/下载 + 明确的人工交接步骤（不声称自动调用） */
export function ExportPanel({
  projectId,
  productionStatus,
  exportedAt,
  warnings,
}: ExportPanelProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [json, setJson] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleExport() {
    if (loading) return;
    setLoading(true);
    setError(null);
    setCopied(false);
    try {
      const res = await fetch(`/api/content-projects/${projectId}/export`, { cache: "no-store" });
      const text = await res.text();
      if (!res.ok) {
        let msg = "导出失败";
        try {
          const data = JSON.parse(text) as { errors?: Record<string, string> };
          msg = Object.values(data.errors ?? {})[0] ?? msg;
        } catch {
          // 忽略解析失败
        }
        throw new Error(msg);
      }
      const parsed = JSON.parse(text) as unknown;
      setJson(JSON.stringify(parsed, null, 2));
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "导出失败");
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    if (!json) return;
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("浏览器拒绝了剪贴板写入，请手动全选复制");
    }
  }

  function handleDownload() {
    if (!json) return;
    const blob = new Blob([json], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "production_input.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="glass-card p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-[15px] font-semibold text-[var(--color-text-primary)]">
            导出到生产流水线
          </h2>
          <p className="text-[12px] text-[var(--color-text-muted)] mt-1">
            生成标准 JSON 文件供 AI_DIRECTOR_PROJECT 使用。平台不会写入你的磁盘，也不会自动调用该流水线。
          </p>
        </div>
        <button
          type="button"
          onClick={handleExport}
          disabled={loading}
          className="inline-flex items-center gap-1.5 h-10 px-4 rounded-lg bg-[var(--color-accent)] text-white text-[13px] font-medium hover:opacity-90 transition-opacity disabled:opacity-60"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
          {json ? "重新导出" : "导出 production_input.json"}
        </button>
      </div>

      <div className="flex items-center gap-3 flex-wrap text-[12px] text-[var(--color-text-muted)]">
        <span>当前生产状态：{productionStatus}</span>
        {exportedAt && <span>上次导出：{new Date(exportedAt).toLocaleString("zh-CN")}</span>}
      </div>

      {warnings.length > 0 && (
        <ul className="flex flex-col gap-1.5 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2.5">
          {warnings.map((w) => (
            <li key={w} className="flex items-start gap-1.5 text-[12px] text-amber-400/90 leading-relaxed">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              {w}
            </li>
          ))}
        </ul>
      )}

      <div>
        <h3 className="text-[12px] font-medium text-[var(--color-text-secondary)] mb-2">
          文件交接步骤（需要你手动操作）
        </h3>
        <ol className="flex flex-col gap-1.5">
          {STEPS.map((s, i) => (
            <li key={s} className="flex items-start gap-2 text-[12px] text-[var(--color-text-muted)] leading-relaxed">
              <span className="shrink-0 w-4 h-4 rounded-full border border-[var(--color-border-subtle)] text-[10px] flex items-center justify-center tabular-nums">
                {i + 1}
              </span>
              {s}
            </li>
          ))}
        </ol>
      </div>

      {json && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[12px] text-[var(--color-text-secondary)]">
              production_input.json 预览
            </span>
            <span className="flex-1" />
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-[var(--color-border-subtle)] text-[12px] text-[var(--color-text-secondary)] hover:border-[var(--color-border-glow)] hover:text-[var(--color-text-primary)] transition-colors"
            >
              {copied ? <Check size={12} /> : <ClipboardCopy size={12} />}
              {copied ? "已复制" : "复制 JSON"}
            </button>
            <button
              type="button"
              onClick={handleDownload}
              className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-[var(--color-border-subtle)] text-[12px] text-[var(--color-text-secondary)] hover:border-[var(--color-border-glow)] hover:text-[var(--color-text-primary)] transition-colors"
            >
              <Download size={12} />
              下载文件
            </button>
          </div>
          <pre className="max-h-80 overflow-auto rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] p-3 text-[11px] leading-relaxed text-[var(--color-text-secondary)] font-mono">
            {json}
          </pre>
        </div>
      )}

      {error && <p className="text-[12px] text-[var(--color-danger)]">{error}</p>}
    </section>
  );
}
