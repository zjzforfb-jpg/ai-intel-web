"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Star, Trash2 } from "lucide-react";
import { IDEA_STATUSES, type IdeaRow, type IdeaStatus } from "@/lib/ideas-shared";
import { CreateProjectButton } from "@/components/content/CreateProjectButton";
import { StatusBadge } from "@/components/ideas/StatusBadge";
import { IdeaForm } from "./IdeaForm";

/**
 * 选题列表行（列表流形态，非卡片）。
 *
 * 与旧版 IdeaCard 的差别：
 * - 版式从「竖排卡片」改为「横向一行」：标题与元信息在左，评分/状态/操作在右；
 * - 详情内容（角度/素材/画面）默认只展示角度，其余收进展开区，避免一行文字过长；
 * - 状态徽章改走主题令牌（StatusBadge）。
 */
export function IdeaListRow({ idea }: { idea: IdeaRow }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
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
      <div className="card-m">
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

  const hasDetail = !!(idea.source_material || idea.reference_visuals);

  return (
    <article
      id={`idea-${idea.id}`}
      className="group relative border-b border-[var(--color-border-subtle)] last:border-b-0 scroll-mt-24"
    >
      {/* 桌面：标题在左、评分/状态/操作在右；移动端：整列堆叠，避免右侧被撑破 */}
      <div className="flex flex-col lg:flex-row lg:items-start lg:gap-3 py-3 px-3 -mx-3 rounded-lg transition-colors hover:bg-[var(--color-bg-card-hover)]">
        {/* 主体：标题 + 角度 */}
        <div className="min-w-0 flex-1">
          <h3 className="text-[14px] font-semibold text-[var(--color-text-primary)] leading-snug [overflow-wrap:anywhere]">
            {idea.title}
          </h3>
          {idea.angle && (
            <p className="mt-1 text-[13px] text-[var(--color-text-secondary)] [overflow-wrap:anywhere] line-clamp-2">
              <span className="text-[var(--color-text-muted)]">角度：</span>
              {idea.angle}
            </p>
          )}
          <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
            来源日报 {idea.report_date}
            {hasDetail && (
              <>
                {" · "}
                <button
                  type="button"
                  onClick={() => setExpanded((v) => !v)}
                  className="underline underline-offset-2 hover:text-[var(--color-text-secondary)]"
                  aria-expanded={expanded}
                >
                  {expanded ? "收起详情" : "展开详情"}
                </button>
              </>
            )}
          </p>
        </div>

        {/* 右侧：评分 + 状态 + 操作 */}
        <div className="mt-2 lg:mt-0 flex flex-wrap items-center gap-2 shrink-0">
          {idea.value_score != null && (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-medium tnum"
              style={{
                color: "var(--color-warning)",
                borderColor: "color-mix(in srgb, var(--color-warning) 35%, transparent)",
                background: "color-mix(in srgb, var(--color-warning) 10%, transparent)",
              }}
            >
              <Star size={10} />
              {idea.value_score}
            </span>
          )}
          <StatusBadge status={status} />

          <select
            value={status}
            onChange={(e) => changeStatus(e.target.value as IdeaStatus)}
            disabled={switching}
            aria-label={`切换「${idea.title}」的状态`}
            className="h-7 pl-2 pr-1 rounded-md bg-[var(--color-bg-card)] border border-[var(--color-border-subtle)] text-[12px] text-[var(--color-text-secondary)] focus:outline-none focus:border-[var(--color-border-glow)] disabled:opacity-60"
          >
            {IDEA_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          {switching && <Loader2 size={13} className="animate-spin text-[var(--color-text-muted)]" />}

          <div className="flex items-center gap-1">
            <CreateProjectButton
              topicIdeaId={idea.id}
              label="转内容"
              className="inline-flex items-center gap-1 h-7 px-2 rounded-md border border-[var(--color-border-glow)] bg-[var(--color-accent-glow)] text-[12px] text-[var(--color-accent-light)] hover:brightness-110 transition disabled:opacity-60"
            />
            <button
              type="button"
              onClick={() => setEditing(true)}
              aria-label="编辑"
              className="inline-flex items-center justify-center h-7 w-7 rounded-md border border-[var(--color-border-subtle)] text-[var(--color-text-muted)] hover:border-[var(--color-border-glow)] hover:text-[var(--color-text-primary)] transition-colors"
            >
              <Pencil size={12} />
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              aria-label="删除"
              className="btn-ghost-danger inline-flex items-center justify-center h-7 w-7 p-0 rounded-md border border-[var(--color-border-subtle)]"
            >
              {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
            </button>
          </div>
        </div>
      </div>

      {/* 展开区：素材来源 + 参考画面 */}
      {expanded && hasDetail && (
        <div className="pb-3 px-3 -mx-3 pt-1 flex flex-col gap-1.5">
          {idea.source_material && (
            <p className="text-[13px] text-[var(--color-text-muted)] leading-relaxed [overflow-wrap:anywhere]">
              <span className="text-[var(--color-text-secondary)]">素材：</span>
              {idea.source_material}
            </p>
          )}
          {idea.reference_visuals && (
            <p className="text-[13px] text-[var(--color-text-muted)] leading-relaxed [overflow-wrap:anywhere]">
              <span className="text-[var(--color-text-secondary)]">画面：</span>
              {idea.reference_visuals}
            </p>
          )}
        </div>
      )}

      {error && <p className="pb-2 px-3 text-[12px] text-[var(--color-danger)]">{error}</p>}
    </article>
  );
}
