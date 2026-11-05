"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { OpportunityForm } from "./OpportunityForm";

interface CreateOpportunitySectionProps {
  knownCategories?: string[];
}

/** 列表页「新建机会」入口：点击展开/收起创建表单 */
export function CreateOpportunitySection({ knownCategories = [] }: CreateOpportunitySectionProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-col items-end gap-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="inline-flex items-center gap-2 h-11 px-5 rounded-lg bg-[var(--color-accent)] text-white text-[15px] font-medium hover:opacity-90 transition-opacity"
      >
        {open ? <X size={16} /> : <Plus size={16} />}
        {open ? "收起表单" : "新建机会"}
      </button>

      {open && (
        <div className="w-full glass-card p-5">
          <h2 className="text-[15px] font-semibold text-[var(--color-text-primary)] mb-4">
            新建商业机会
          </h2>
          <OpportunityForm
            mode="create"
            knownCategories={knownCategories}
            onCancel={() => setOpen(false)}
          />
        </div>
      )}
    </div>
  );
}
