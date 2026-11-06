"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import {
  PRODUCTION_STATUSES,
  isProductionStatus,
  type ProductionStatus,
} from "@/lib/content-projects-shared";

interface ImportPanelProps {
  projectId: number;
  productionStatus: ProductionStatus;
}

const FIELDS = [
  { key: "scriptResult", label: "脚本结果（script_result）", hint: "例如 01_bible / 04_director 阶段产出的结构" },
  { key: "storyboardResult", label: "分镜结果（storyboard_result）", hint: "例如 05_storyboards/storyboard.md 的整理结果" },
  { key: "qualityCheck", label: "质检结果（quality_check）", hint: "例如 09_review 的检查结论" },
] as const;

const textareaClass =
  "w-full px-3 py-2 rounded-lg bg-[var(--color-bg-card)] border border-[var(--color-border-subtle)] text-[12px] leading-relaxed font-mono text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-border-glow)] resize-y";

/**
 * 回读区：把用户生产系统的产物整理成 JSON 提交。
 * 平台不读磁盘、不调用任何脚本，全部由用户粘贴。
 */
export function ImportPanel({ projectId, productionStatus }: ImportPanelProps) {
  const router = useRouter();
  const [script, setScript] = useState("");
  const [storyboard, setStoryboard] = useState("");
  const [quality, setQuality] = useState("");
  const [status, setStatus] = useState<ProductionStatus>(productionStatus);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const [open, setOpen] = useState(false);

  async function handleSubmit() {
    if (loading) return;
    setError(null);
    setDone(false);

    const payload: Record<string, unknown> = { productionStatus: status };
    const entries: Array<[string, string]> = [
      ["scriptResult", script],
      ["storyboardResult", storyboard],
      ["qualityCheck", quality],
    ];
    for (const [key, raw] of entries) {
      const text = raw.trim();
      if (!text) continue;
      try {
        payload[key] = JSON.parse(text) as unknown;
      } catch {
        setError(`${key} 不是合法 JSON，请先检查格式（字符串需要加引号）`);
        return;
      }
    }

    if (!isProductionStatus(payload.productionStatus)) {
      setError("生产状态不合法");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/content-projects/${projectId}/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      let data: { ok?: boolean; errors?: Record<string, string> } = {};
      try {
        data = await res.json();
      } catch {
        // 非 JSON 响应按失败处理
      }
      if (!res.ok || !data.ok) {
        throw new Error(Object.values(data.errors ?? {})[0] ?? "回读失败");
      }
      setDone(true);
      setScript("");
      setStoryboard("");
      setQuality("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "回读失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="glass-card p-5 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-[15px] font-semibold text-[var(--color-text-primary)]">
            回读生产结果
          </h2>
          <p className="text-[12px] text-[var(--color-text-muted)] mt-1 leading-relaxed">
            把流水线产物整理成 JSON 粘贴进来，平台只保存，不解析、不评判内容。
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="inline-flex items-center h-9 px-3 rounded-lg border border-[var(--color-border-subtle)] text-[13px] text-[var(--color-text-secondary)] hover:border-[var(--color-border-glow)] hover:text-[var(--color-text-primary)] transition-colors"
        >
          {open ? "收起" : "展开回读"}
        </button>
      </div>

      {open && (
        <>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-[var(--color-text-secondary)]">
              推进到哪个生产状态
            </span>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as ProductionStatus)}
              className="h-10 px-3 rounded-lg bg-[var(--color-bg-card)] border border-[var(--color-border-subtle)] text-[13px] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-border-glow)]"
            >
              {PRODUCTION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>

          {FIELDS.map((f) => {
            const value = f.key === "scriptResult" ? script : f.key === "storyboardResult" ? storyboard : quality;
            const setValue =
              f.key === "scriptResult" ? setScript : f.key === "storyboardResult" ? setStoryboard : setQuality;
            return (
              <label key={f.key} className="flex flex-col gap-1.5">
                <span className="text-[12px] font-medium text-[var(--color-text-secondary)]">
                  {f.label}
                </span>
                <textarea
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  className={textareaClass}
                  rows={3}
                  placeholder={`${f.hint}；留空表示本次不上报`}
                />
              </label>
            );
          })}

          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={loading}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-[var(--color-accent)] text-white text-[13px] font-medium hover:opacity-90 transition-opacity disabled:opacity-60"
            >
              {loading ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
              保存回读结果
            </button>
            {done && <span className="text-[12px] text-[var(--color-success)]">已保存</span>}
            {error && <span className="text-[12px] text-[var(--color-danger)]">{error}</span>}
          </div>
        </>
      )}
    </section>
  );
}
