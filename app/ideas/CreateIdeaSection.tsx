"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { IdeaForm } from "./IdeaForm";

/**
 * 新建选题入口。
 *
 * 两种形态：
 * - inline（默认）：页头动作区的一个按钮，展开后表单就地铺开在按钮下方；
 * - 折叠时不再占用一整行空卡（早期版本用一个 glass-card 把按钮包起来，
 *   在 1440 视口下白占 60px 高，把焦点区压到第二屏）。
 */
export function CreateIdeaSection({ variant = "inline" }: { variant?: "inline" | "block" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const today = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const defaultDate = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

  // Esc 关闭
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const trigger = (
    <button
      type="button"
      onClick={() => setOpen((v) => !v)}
      aria-expanded={open}
      className="btn-primary"
    >
      {open ? <X size={14} /> : <Plus size={14} />}
      {open ? "取消" : "新建选题"}
    </button>
  );

  if (variant === "block") {
    return (
      <div className="card-m">
        {trigger}
        {open && (
          <div className="mt-4 pt-4 border-t border-[var(--color-border-subtle)]">
            <h2 className="text-[15px] font-semibold text-[var(--color-text-primary)] mb-3.5">
              新建选题
            </h2>
            <IdeaForm
              mode="create"
              defaultDate={defaultDate}
              onDone={() => setOpen(false)}
              onCancel={() => setOpen(false)}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-3">
      {trigger}
      {open && (
        <div className="w-full card-l">
          <h2 className="text-[15px] font-semibold text-[var(--color-text-primary)] mb-3.5">
            新建选题
          </h2>
          <IdeaForm
            mode="create"
            defaultDate={defaultDate}
            onDone={() => {
              setOpen(false);
              router.refresh();
            }}
            onCancel={() => setOpen(false)}
          />
        </div>
      )}
    </div>
  );
}

/** 保留旧引用兼容：导入方若未传 variant，按 block 渲染 */
export default CreateIdeaSection;
