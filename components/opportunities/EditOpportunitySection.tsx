"use client";

import { useState } from "react";
import { Pencil, X } from "lucide-react";
import { OpportunityForm } from "./OpportunityForm";
import type { OpportunityRow } from "@/lib/opportunities-shared";

interface EditOpportunitySectionProps {
  item: OpportunityRow;
  knownCategories?: string[];
}

/** 详情页「编辑信息」入口：点击展开/收起编辑表单（标题、分类、日期、描述、备注、行动计划） */
export function EditOpportunitySection({ item, knownCategories = [] }: EditOpportunitySectionProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="inline-flex items-center gap-2 h-11 px-5 rounded-lg bg-[var(--color-bg-card)] border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] text-[14px] hover:border-[var(--color-border-glow)] hover:text-[var(--color-text-primary)] transition-all"
        >
          {open ? <X size={15} /> : <Pencil size={15} />}
          {open ? "收起编辑" : "编辑信息"}
        </button>
      </div>

      {open && (
        <div className="glass-card p-5">
          <h2 className="text-[15px] font-semibold text-[var(--color-text-primary)] mb-4">
            编辑机会信息
          </h2>
          <OpportunityForm
            mode="edit"
            initial={item}
            knownCategories={knownCategories}
            onCancel={() => setOpen(false)}
            onSaved={() => setOpen(false)}
          />
        </div>
      )}
    </div>
  );
}
