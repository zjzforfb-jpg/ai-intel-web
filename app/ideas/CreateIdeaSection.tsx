"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { IdeaForm } from "./IdeaForm";

/** 新建选题（可折叠表单，日期默认今天） */
export function CreateIdeaSection() {
  const [open, setOpen] = useState(false);
  const today = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const defaultDate = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

  return (
    <div className="glass-card p-4">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-2 h-10 px-4 rounded-lg border border-[var(--color-border-subtle)] text-[14px] text-[var(--color-text-secondary)] hover:border-[var(--color-border-glow)] hover:text-[var(--color-text-primary)] transition-colors"
        >
          <Plus size={15} />
          新建选题
        </button>
      ) : (
        <div>
          <h2 className="text-[15px] font-semibold text-[var(--color-text-primary)] mb-3.5">
            新建选题
          </h2>
          <IdeaForm mode="create" defaultDate={defaultDate} onDone={() => setOpen(false)} onCancel={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}
