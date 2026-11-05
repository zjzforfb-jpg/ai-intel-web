"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2, X } from "lucide-react";
import { deleteTopicAction } from "@/lib/topics-actions";

/**
 * 删除专题按钮：两步确认（点击删除 → 确认/取消），防误触。
 * 删除成功后跳转 redirectHref（默认回专题列表）并刷新路由数据。
 */
export function DeleteTopicButton({
  topicId,
  topicName,
  redirectHref = "/topics",
  size = "md",
}: {
  topicId: number;
  topicName: string;
  redirectHref?: string;
  size?: "md" | "sm";
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const baseClass =
    size === "sm"
      ? "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[13px] transition-all"
      : "inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-[13px] transition-all";

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deleteTopicAction(topicId);
      if (result.ok) {
        router.push(redirectHref);
        router.refresh();
      } else {
        setConfirming(false);
        setError(result.message);
      }
    });
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      {!confirming ? (
        <button
          type="button"
          onClick={() => {
            setConfirming(true);
            setError(null);
          }}
          className={`${baseClass} border-red-500/30 bg-red-500/10 text-red-300 hover:border-red-500/50 hover:bg-red-500/20`}
        >
          <Trash2 size={15} />
          删除
        </button>
      ) : (
        <span className="inline-flex max-w-full flex-wrap items-center gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-2.5 py-1.5">
          <span className="min-w-0 break-words text-[13px] text-red-200">确认删除「{topicName}」？</span>
          <button
            type="button"
            onClick={handleDelete}
            disabled={pending}
            className="inline-flex items-center gap-1 rounded-md bg-red-500 px-2.5 py-1 text-[13px] text-white hover:bg-red-600 disabled:opacity-60"
          >
            {pending && <Loader2 size={13} className="animate-spin" />}
            确认
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={pending}
            className="inline-flex items-center gap-1 rounded-md border border-[var(--color-border-subtle)] px-2.5 py-1 text-[13px] text-[var(--color-text-secondary)] hover:border-[var(--color-border-glow)] disabled:opacity-60"
          >
            <X size={13} />
            取消
          </button>
        </span>
      )}
      {error && <span className="text-[13px] text-red-400">{error}</span>}
    </span>
  );
}
