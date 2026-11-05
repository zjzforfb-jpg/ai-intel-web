"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save, X } from "lucide-react";
import {
  OPPORTUNITY_STATUSES,
  validateOpportunity,
  type OpportunityField,
  type OpportunityFieldErrors,
  type OpportunityRow,
  type OpportunityStatus,
} from "@/lib/opportunities-shared";

interface OpportunityFormProps {
  mode: "create" | "edit";
  /** 编辑模式的初始值 */
  initial?: OpportunityRow;
  /** 已有分类（datalist 提示，仍是自由输入） */
  knownCategories?: string[];
  onCancel?: () => void;
  /** 保存成功后回调（编辑模式用于收起表单） */
  onSaved?: (item: OpportunityRow) => void;
}

interface FormState {
  title: string;
  description: string;
  category: string;
  source_report_date: string;
  status: OpportunityStatus;
  notes: string;
  action_plan: string;
}

function toFormState(row: OpportunityRow): FormState {
  return {
    title: row.title,
    description: row.description ?? "",
    category: row.category ?? "",
    source_report_date: row.source_report_date ?? "",
    status: row.status,
    notes: row.notes ?? "",
    action_plan: row.action_plan ?? "",
  };
}

const emptyState: FormState = {
  title: "",
  description: "",
  category: "",
  source_report_date: "",
  status: "待研究",
  notes: "",
  action_plan: "",
};

/** 除 status 外都是纯文本字段 */
type TextField = Exclude<keyof FormState, "status">;

const inputClass =
  "w-full h-11 px-3 rounded-lg bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] text-[15px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-border-glow)]";
const textareaClass =
  "w-full min-h-[110px] px-3 py-2.5 rounded-lg bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] text-[14px] leading-relaxed text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-border-glow)] resize-y [overflow-wrap:anywhere]";
const labelClass = "block text-[13px] text-[var(--color-text-secondary)] font-medium mb-1.5";
const errorClass = "mt-1 text-[13px] text-[var(--color-danger)]";

/** 机会新建 / 编辑表单：title 必填、status 四选一、日期格式校验 */
export function OpportunityForm({
  mode,
  initial,
  knownCategories = [],
  onCancel,
  onSaved,
}: OpportunityFormProps) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(() =>
    initial ? toFormState(initial) : emptyState
  );
  const [errors, setErrors] = useState<OpportunityFieldErrors>({});
  const [saving, setSaving] = useState(false);

  function setField(field: TextField, value: string) {
    setForm((prev) => {
      const next = { ...prev };
      next[field] = value;
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;

    // 与服务端共用同一套校验规则，先在客户端拦一层
    const result = validateOpportunity(form, mode === "create" ? "create" : "update");
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }

    setSaving(true);
    setErrors({});
    try {
      const res =
        mode === "create"
          ? await fetch("/api/opportunities", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(form),
            })
          : await fetch(`/api/opportunities/${initial?.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(form),
            });

      let data: {
        ok?: boolean;
        item?: OpportunityRow;
        errors?: OpportunityFieldErrors;
      } = {};
      try {
        data = await res.json();
      } catch {
        // 非 JSON 响应按失败处理
      }

      if (!res.ok || !data.ok || !data.item) {
        setErrors(
          data.errors ?? { form: mode === "create" ? "创建失败，请稍后重试" : "保存失败，请稍后重试" }
        );
        return;
      }

      if (mode === "create") {
        // 创建成功直接进入详情页
        router.push(`/opportunities/${data.item.id}`);
        router.refresh();
      } else {
        onSaved?.(data.item);
        router.refresh();
      }
    } catch {
      setErrors({ form: "网络请求失败，请稍后重试" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      {errors.form && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-[13px] text-red-400">
          {errors.form}
        </div>
      )}

      {/* 标题（必填） */}
      <div>
        <label htmlFor="opp-title" className={labelClass}>
          标题 <span className="text-[var(--color-danger)]">*</span>
        </label>
        <input
          id="opp-title"
          type="text"
          value={form.title}
          onChange={(e) => setField("title", e.target.value)}
          placeholder="一句话概括这个商业机会"
          maxLength={200}
          aria-required
          aria-invalid={!!errors.title}
          className={inputClass}
        />
        {errors.title && <p className={errorClass}>{errors.title}</p>}
      </div>

      {/* 状态 / 分类 / 来源日期 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label htmlFor="opp-status" className={labelClass}>
            状态
          </label>
          <select
            id="opp-status"
            value={form.status}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, status: e.target.value as OpportunityStatus }))
            }
            aria-invalid={!!errors.status}
            className={inputClass}
          >
            {OPPORTUNITY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          {errors.status && <p className={errorClass}>{errors.status}</p>}
        </div>

        <div>
          <label htmlFor="opp-category" className={labelClass}>
            分类
          </label>
          <input
            id="opp-category"
            type="text"
            value={form.category}
            onChange={(e) => setField("category", e.target.value)}
            placeholder="自由分类，如：AI 工具"
            list="opp-category-options"
            maxLength={100}
            aria-invalid={!!errors.category}
            className={inputClass}
          />
          {knownCategories.length > 0 && (
            <datalist id="opp-category-options">
              {knownCategories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          )}
          {errors.category && <p className={errorClass}>{errors.category}</p>}
        </div>

        <div>
          <label htmlFor="opp-source-date" className={labelClass}>
            来源日报日期
          </label>
          <input
            id="opp-source-date"
            type="date"
            value={form.source_report_date}
            onChange={(e) => setField("source_report_date", e.target.value)}
            style={{ colorScheme: "dark" }}
            aria-invalid={!!errors.source_report_date}
            className={inputClass}
          />
          {errors.source_report_date && <p className={errorClass}>{errors.source_report_date}</p>}
        </div>
      </div>

      {/* 描述 */}
      <div>
        <label htmlFor="opp-description" className={labelClass}>
          机会描述
        </label>
        <textarea
          id="opp-description"
          value={form.description}
          onChange={(e) => setField("description", e.target.value)}
          placeholder="机会的背景、来源与价值判断"
          maxLength={20000}
          aria-invalid={!!errors.description}
          className={textareaClass}
        />
        {errors.description && <p className={errorClass}>{errors.description}</p>}
      </div>

      {/* 备注 */}
      <div>
        <label htmlFor="opp-notes" className={labelClass}>
          备注
        </label>
        <textarea
          id="opp-notes"
          value={form.notes}
          onChange={(e) => setField("notes", e.target.value)}
          placeholder="研究过程中的想法、进展与结论"
          maxLength={20000}
          aria-invalid={!!errors.notes}
          className={textareaClass}
        />
        {errors.notes && <p className={errorClass}>{errors.notes}</p>}
      </div>

      {/* 行动计划 */}
      <div>
        <label htmlFor="opp-action-plan" className={labelClass}>
          行动计划
        </label>
        <textarea
          id="opp-action-plan"
          value={form.action_plan}
          onChange={(e) => setField("action_plan", e.target.value)}
          placeholder="下一步要做什么？拆成可执行的步骤"
          maxLength={20000}
          aria-invalid={!!errors.action_plan}
          className={textareaClass}
        />
        {errors.action_plan && <p className={errorClass}>{errors.action_plan}</p>}
      </div>

      {/* 操作 */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-2 h-11 px-5 rounded-lg bg-[var(--color-accent)] text-white text-[15px] font-medium hover:opacity-90 transition-opacity disabled:opacity-60"
        >
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
          {saving ? "保存中…" : mode === "create" ? "创建机会" : "保存修改"}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="inline-flex items-center gap-1.5 h-11 px-4 rounded-lg bg-[var(--color-bg-card)] border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] text-[14px] hover:border-[var(--color-border-glow)] hover:text-[var(--color-text-primary)] transition-all disabled:opacity-60"
          >
            <X size={15} />
            取消
          </button>
        )}
      </div>
    </form>
  );
}
