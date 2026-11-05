"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";

interface DeleteOpportunityButtonProps {
  id: number;
  title: string;
}

/** 删除机会（需二次确认），成功后回到列表页 */
export function DeleteOpportunityButton({ id, title }: DeleteOpportunityButtonProps) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    if (deleting) return;
    const confirmed = window.confirm(
      `确认删除机会「${title}」？\n此操作不可恢复。`
    );
    if (!confirmed) return;

    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/opportunities/${id}`, { method: "DELETE" });
      let data: { ok?: boolean; errors?: { form?: string } } = {};
      try {
        data = await res.json();
      } catch {
        // 非 JSON 响应按失败处理
      }
      if (!res.ok || !data.ok) {
        throw new Error(data.errors?.form ?? "删除失败");
      }
      router.push("/opportunities");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
      setDeleting(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleDelete}
        disabled={deleting}
        className="inline-flex items-center gap-2 h-11 px-4 rounded-lg border border-red-500/30 bg-red-500/10 text-red-400 text-[14px] hover:bg-red-500/20 transition-colors disabled:opacity-60"
      >
        {deleting ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
        {deleting ? "删除中…" : "删除该机会"}
      </button>
      {error && <p className="mt-2 text-[13px] text-[var(--color-danger)]">{error}</p>}
    </div>
  );
}
