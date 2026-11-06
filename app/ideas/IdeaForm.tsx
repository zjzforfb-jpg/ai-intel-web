"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { IDEA_STATUSES, type IdeaRow, type IdeaStatus } from "@/lib/ideas-shared";

interface IdeaFormValues {
  report_date: string;
  title: string;
  angle: string;
  source_material: string;
  reference_visuals: string;
  value_score: string;
  status: IdeaStatus;
}

interface IdeaFormProps {
  mode: "create" | "edit";
  idea?: IdeaRow;
  /** create 模式的默认日期（一般为今天） */
  defaultDate?: string;
  onDone: () => void;
  onCancel: () => void;
}

function initialValues(idea: IdeaRow | undefined, defaultDate: string): IdeaFormValues {
  return {
    report_date: idea?.report_date ?? defaultDate,
    title: idea?.title ?? "",
    angle: idea?.angle ?? "",
    source_material: idea?.source_material ?? "",
    reference_visuals: idea?.reference_visuals ?? "",
    value_score: idea?.value_score != null ? String(idea.value_score) : "",
    status: idea?.status ?? "待制作",
  };
}

/** 选题新建/编辑表单（create → POST /api/ideas，edit → PATCH /api/ideas/:id） */
export function IdeaForm({ mode, idea, defaultDate = "", onDone, onCancel }: IdeaFormProps) {
  const router = useRouter();
  const [values, setValues] = useState<IdeaFormValues>(() => initialValues(idea, defaultDate));
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function set<K extends keyof IdeaFormValues>(key: K, v: IdeaFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: v }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;

    const scoreTrim = values.value_score.trim();
    const payload: Record<string, unknown> = {
      report_date: values.report_date,
      title: values.title,
      angle: values.angle,
      source_material: values.source_material,
      reference_visuals: values.reference_visuals,
      status: values.status,
    };
    // 评分留空 = 不评分（null），填了则提交数字
    payload.value_score = scoreTrim === "" ? null : Number(scoreTrim);

    setSaving(true);
    setErrors({});
    try {
      const res = await fetch(
        mode === "create" ? "/api/ideas" : `/api/ideas/${idea?.id}`,
        {
          method: mode === "create" ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      let data: { ok?: boolean; errors?: Record<string, string> } = {};
      try {
        data = await res.json();
      } catch {
        // 非 JSON 响应按失败处理
      }
      if (!res.ok || !data.ok) {
        setErrors(data.errors ?? { form: "保存失败" });
        return;
      }
      onDone();
      router.refresh();
    } catch {
      setErrors({ form: "网络错误，请重试" });
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    "w-full h-10 px-3 rounded-lg bg-[var(--color-bg-card)] border border-[var(--color-border-subtle)] text-[14px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-border-glow)]";
  const labelClass = "block text-[13px] font-medium text-[var(--color-text-secondary)] mb-1.5";

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        <div className="md:col-span-2">
          <label className={labelClass} htmlFor="idea-title">
            标题钩子 *
          </label>
          <input
            id="idea-title"
            type="text"
            value={values.title}
            onChange={(e) => set("title", e.target.value)}
            maxLength={200}
            placeholder="短视频标题，要有钩子感"
            className={inputClass}
          />
          {errors.title && <p className="mt-1 text-[12px] text-[var(--color-danger)]">{errors.title}</p>}
        </div>

        <div>
          <label className={labelClass} htmlFor="idea-date">
            来源日报日期 *
          </label>
          <input
            id="idea-date"
            type="date"
            value={values.report_date}
            onChange={(e) => set("report_date", e.target.value)}
            className={inputClass}
          />
          {errors.report_date && (
            <p className="mt-1 text-[12px] text-[var(--color-danger)]">{errors.report_date}</p>
          )}
        </div>

        <div>
          <label className={labelClass} htmlFor="idea-score">
            选题价值评分（1-10，可留空）
          </label>
          <input
            id="idea-score"
            type="number"
            min={1}
            max={10}
            step={1}
            value={values.value_score}
            onChange={(e) => set("value_score", e.target.value)}
            className={inputClass}
          />
          {errors.value_score && (
            <p className="mt-1 text-[12px] text-[var(--color-danger)]">{errors.value_score}</p>
          )}
        </div>

        <div>
          <label className={labelClass} htmlFor="idea-status">
            状态
          </label>
          <select
            id="idea-status"
            value={values.status}
            onChange={(e) => set("status", e.target.value as IdeaStatus)}
            className={inputClass}
          >
            {IDEA_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          {errors.status && (
            <p className="mt-1 text-[12px] text-[var(--color-danger)]">{errors.status}</p>
          )}
        </div>

        <div>
          <label className={labelClass} htmlFor="idea-angle">
            切入角度
          </label>
          <input
            id="idea-angle"
            type="text"
            value={values.angle}
            onChange={(e) => set("angle", e.target.value)}
            placeholder="从什么视角讲这个选题"
            className={inputClass}
          />
          {errors.angle && (
            <p className="mt-1 text-[12px] text-[var(--color-danger)]">{errors.angle}</p>
          )}
        </div>

        <div className="md:col-span-2">
          <label className={labelClass} htmlFor="idea-material">
            素材来源（日报中哪条/哪些文章、链接）
          </label>
          <textarea
            id="idea-material"
            value={values.source_material}
            onChange={(e) => set("source_material", e.target.value)}
            rows={2}
            className={`${inputClass} h-auto py-2 resize-y`}
          />
          {errors.source_material && (
            <p className="mt-1 text-[12px] text-[var(--color-danger)]">{errors.source_material}</p>
          )}
        </div>

        <div className="md:col-span-2">
          <label className={labelClass} htmlFor="idea-visuals">
            参考画面（建议的画面/镜头描述）
          </label>
          <textarea
            id="idea-visuals"
            value={values.reference_visuals}
            onChange={(e) => set("reference_visuals", e.target.value)}
            rows={2}
            className={`${inputClass} h-auto py-2 resize-y`}
          />
          {errors.reference_visuals && (
            <p className="mt-1 text-[12px] text-[var(--color-danger)]">{errors.reference_visuals}</p>
          )}
        </div>
      </div>

      {errors.form && <p className="text-[13px] text-[var(--color-danger)]">{errors.form}</p>}

      <div className="flex items-center gap-2.5">
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-[var(--color-accent)] text-white text-[14px] font-medium hover:opacity-90 transition-opacity disabled:opacity-60"
        >
          {saving && <Loader2 size={15} className="animate-spin" />}
          {mode === "create" ? "保存选题" : "保存修改"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="h-10 px-4 rounded-lg border border-[var(--color-border-subtle)] text-[14px] text-[var(--color-text-secondary)] hover:border-[var(--color-border-glow)] hover:text-[var(--color-text-primary)] transition-colors disabled:opacity-60"
        >
          取消
        </button>
      </div>
    </form>
  );
}
