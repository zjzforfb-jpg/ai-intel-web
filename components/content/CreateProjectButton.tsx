"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";

interface CreateProjectButtonProps {
  topicIdeaId: number;
  /** 默认内容类型，缺省由后端取 ai_news */
  contentType?: string;
  targetAudience?: string;
  label?: string;
  className?: string;
}

/**
 * 「创建内容项目」按钮：由主控挂到选题列表/详情（Agent B 不改公共页面）。
 *
 * 行为：
 * - 201 新建成功 → 跳到 /content/[id]
 * - 409 已存在 → 提示后跳到既有项目（不重复创建）
 * - 404 选题不存在 → 行内错误提示，不跳转
 */
export function CreateProjectButton({
  topicIdeaId,
  contentType,
  targetAudience,
  label = "创建内容项目",
  className = "",
}: CreateProjectButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleClick() {
    if (loading) return;
    setLoading(true);
    setError(null);
    setNotice(null);

    try {
      const res = await fetch("/api/content-projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topicIdeaId,
          ...(contentType ? { contentType } : {}),
          ...(targetAudience ? { targetAudience } : {}),
        }),
      });

      let data: {
        ok?: boolean;
        id?: number;
        existingId?: number;
        errors?: Record<string, string>;
      } = {};
      try {
        data = await res.json();
      } catch {
        // 非 JSON 响应按失败处理
      }

      if (res.status === 404) {
        setError(data.errors?.topicIdeaId ?? "选题不存在或已删除");
        setLoading(false);
        return;
      }

      if (res.status === 409) {
        const id = data.existingId;
        setNotice("该选题已有内容项目，正在打开…");
        if (id) {
          router.push(`/content/${id}`);
          return;
        }
        setError("该选题已有内容项目，但未能取回项目 ID");
        setLoading(false);
        return;
      }

      if (!res.ok || !data.ok || !data.id) {
        setError(data.errors?.form ?? "创建失败");
        setLoading(false);
        return;
      }

      router.push(`/content/${data.id}`);
    } catch {
      setError("网络异常，创建失败");
      setLoading(false);
    }
  }

  return (
    <div className="inline-flex flex-col gap-1.5">
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        className={
          className ||
          "inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-card)] text-[13px] text-[var(--color-text-secondary)] hover:border-[var(--color-border-glow)] hover:text-[var(--color-text-primary)] transition-colors disabled:opacity-60"
        }
      >
        {loading ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
        {label}
      </button>
      {notice && <span className="text-[12px] text-[var(--color-text-muted)]">{notice}</span>}
      {error && <span className="text-[12px] text-[var(--color-danger)]">{error}</span>}
    </div>
  );
}
