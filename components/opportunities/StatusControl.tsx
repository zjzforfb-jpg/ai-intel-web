"use client";

import { useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import {
  OPPORTUNITY_STATUSES,
  STATUS_COLOR_VAR_NAME,
  type OpportunityStatus,
} from "@/lib/opportunities-shared";

interface StatusControlProps {
  id: number;
  current: OpportunityStatus;
}

/**
 * 状态流转控件：四种状态一键切换（PATCH /api/opportunities/:id）。
 * 乐观更新，失败回滚并提示。
 */
export function StatusControl({ id, current }: StatusControlProps) {
  const router = useRouter();
  const [status, setStatus] = useState<OpportunityStatus>(current);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function change(next: OpportunityStatus) {
    if (next === status || pending) return;
    const prev = status;
    setStatus(next);
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/opportunities/${id}`, {
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
      setPending(false);
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap" role="group" aria-label="状态切换">
        {OPPORTUNITY_STATUSES.map((s) => {
          const active = s === status;
          return (
            <button
              key={s}
              type="button"
              onClick={() => change(s)}
              disabled={pending}
              aria-pressed={active}
              style={
                active
                  ? ({
                      "--status-color": `var(${STATUS_COLOR_VAR_NAME[s]})`,
                      color: "var(--status-color)",
                      borderColor:
                        "color-mix(in srgb, var(--status-color) 40%, transparent)",
                      background:
                        "color-mix(in srgb, var(--status-color) 14%, transparent)",
                    } as CSSProperties)
                  : undefined
              }
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-[13px] font-medium transition-all disabled:opacity-60 ${
                active
                  ? ""
                  : "border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-glow)] hover:text-[var(--color-text-primary)]"
              }`}
            >
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: `var(${STATUS_COLOR_VAR_NAME[s]})` }}
                aria-hidden
              />
              {s}
            </button>
          );
        })}
        {pending && <Loader2 size={15} className="animate-spin text-[var(--color-text-muted)]" />}
      </div>

      {error && <p className="mt-2 text-[13px] text-[var(--color-danger)]">{error}</p>}
    </div>
  );
}
