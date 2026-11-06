"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Star, Trash2 } from "lucide-react";
import {
  IDEA_STATUS_BADGE_CLASS,
  IDEA_STATUS_DOT_CLASS,
  IDEA_STATUSES,
  type IdeaRow,
  type IdeaStatus,
} from "@/lib/ideas-shared";
import { IdeaForm } from "./IdeaForm";

/** 单条选题卡片：标题钩子 + 评分 + 状态切换 + 素材/画面 + 行内编辑/删除 */
export function IdeaCard({ idea }: { idea: IdeaRow }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState<IdeaStatus>(idea.status);
  const [switching, setSwitching] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function changeStatus(next: IdeaStatus) {
    if (next === status || switching) return;
    const prev = status;
    setStatus(next);
    setSwitching(true);
    setError(null);
    try {
      const res = await fetch(`/api/ideas/${idea.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      let data: { ok?: boolean; errors?: { form?: string; status?: string } } = {};
      try {
        data = await res.json();
      } catch {
        // 非 JSON 响应按失败处理
      }
      if (!res.ok || !data.ok) {
        throw new Error(data.errors?.status ?? data.errors?.form ?? "状态更新失败");
      }
      router.refresh();
    } catch (e) {
      setStatus(prev);
      setError(e instanceof Error ? e.message : "状态更新失败");
    } finally {
      setSwitching(false);
    }
  }

  async function handleDelete() {
    if (deleting) return;
    const confirmed = window.confirm(
      `确认删除选题「${idea.title}」？\n此操作不可恢复。`
    );
    if (!confirmed) return;

    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/ideas/${idea.id}`, { method: "DELETE" });
      let data: { ok?: boolean; errors?: { form?: string } } = {};
      try {
        data = await res.json();
      } catch {
        // 非 JSON 响应按失败处理
      }
      if (!res.ok || !data.ok) {
        throw new Error(data.errors?.form ?? "删除失败");
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
      setDeleting(false);
    }
  }

  if (editing) {
    return (
      <div className="glass-card p-4">
        <h3 className="text-[15px] font-semibold text-[var(--color-text-primary)] mb-3.5">
          编辑选题
        </h3>
        <IdeaForm
          mode="edit"
          idea={idea}
          onDone={() => setEditing(false)}
          onCancel={() => setEditing(false)}
        />
      </div>
    );
  }

  return (
    <div className="glass-card p-4 flex flex-col gap-2.5">
      {/* 标题 + 评分 */}
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-[15px] font-semibold text-[var(--color-text-primary)] leading-snug min-w-0 [overflow-wrap:anywhere]">
          {idea.title}
        </h3>
        <div className="shrink-0 flex items-center gap-2">
          {idea.value_score != null && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-400 text-[12px] font-medium tabular-nums">
              <Star size={11} />
              {idea.value_score}
            </span>
          )}
          <span
            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[12px] font-medium ${IDEA_STATUS_BADGE_CLASS[status]}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${IDEA_STATUS_DOT_CLASS[status]}`} aria-hidden />
            {status}
          </span>
        </div>
      </div>

      {/* 角度 */}
      {idea.angle && (
        <p className="text-[13px] text-[var(--color-text-secondary)] [overflow-wrap:anywhere]">
          <span className="text-[var(--color-text-muted)]">角度：</span>
          {idea.angle}
        </p>
      )}

      {/* 素材来源 / 参考画面 */}
      {idea.source_material && (
        <p className="text-[13px] text-[var(--color-text-muted)] leading-relaxed line-clamp-3 [overflow-wrap:anywhere]">
          <span className="text-[var(--color-text-secondary)]">素材：</span>
          {idea.source_material}
        </p>
      )}
      {idea.reference_visuals && (
        <p className="text-[13px] text-[var(--color-text-muted)] leading-relaxed line-clamp-3 [overflow-wrap:anywhere]">
          <span className="text-[var(--color-text-secondary)]">画面：</span>
          {idea.reference_visuals}
        </p>
      )}

      {/* 操作行：状态切换 + 编辑 + 删除 */}
      <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-[var(--color-border-subtle)] mt-1">
        <select
          value={status}
          onChange={(e) => changeStatus(e.target.value as IdeaStatus)}
          disabled={switching}
          aria-label="切换状态"
          className="h-8 px-2 rounded-lg bg-[var(--color-bg-card)] border border-[var(--color-border-subtle)] text-[13px] text-[var(--color-text-secondary)] focus:outline-none focus:border-[var(--color-border-glow)] disabled:opacity-60"
        >
          {IDEA_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        {switching && <Loader2 size={14} className="animate-spin text-[var(--color-text-muted)]" />}

        <span className="flex-1" />

        <button
          type="button"
          onClick={() => setEditing(true)}
          className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-[var(--color-border-subtle)] text-[13px] text-[var(--color-text-secondary)] hover:border-[var(--color-border-glow)] hover:text-[var(--color-text-primary)] transition-colors"
        >
          <Pencil size={13} />
          编辑
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting}
          className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-red-500/30 text-[13px] text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-60"
        >
          {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
          删除
        </button>
      </div>

      {error && <p className="text-[13px] text-[var(--color-danger)]">{error}</p>}
    </div>
  );
}
