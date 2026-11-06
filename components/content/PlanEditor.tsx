"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save, Sparkles } from "lucide-react";
import {
  CONTENT_TYPE_LABELS,
  CONTENT_TYPES,
  PROJECT_STATUSES,
  type ContentProjectRow,
  type ContentType,
  type ProjectStatus,
  type ReferenceMaterial,
} from "@/lib/content-projects-shared";
import { generateContentPlan } from "@/lib/content-plan";

interface PlanEditorProps {
  project: ContentProjectRow;
  /** 来源选题原文，仅用于「生成策划草稿」，不改库 */
  source: {
    angle: string | null;
    sourceMaterial: string | null;
    referenceVisuals: string | null;
  };
}

interface FormState {
  title: string;
  content_type: ContentType;
  target_audience: string;
  content_angle: string;
  hook: string;
  key_points: string;
  open_questions: string;
  duration_seconds: string;
  video_form: string;
  production_notes: string;
  status: ProjectStatus;
  reference_materials: string;
}

const inputClass =
  "w-full h-10 px-3 rounded-lg bg-[var(--color-bg-card)] border border-[var(--color-border-subtle)] text-[13px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-border-glow)]";
const textareaClass =
  "w-full px-3 py-2 rounded-lg bg-[var(--color-bg-card)] border border-[var(--color-border-subtle)] text-[13px] leading-relaxed text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-border-glow)] resize-y";

function materialsToText(list: ReferenceMaterial[]): string {
  return list
    .map((m) => [m.title ?? "", m.url ?? "", m.note ?? ""].join(" | ").replace(/\s*\|\s*$/, ""))
    .join("\n");
}

function textToMaterials(text: string): ReferenceMaterial[] {
  const out: ReferenceMaterial[] = [];
  for (const line of text.split("\n")) {
    const raw = line.trim();
    if (!raw) continue;
    const parts = raw.split("|").map((p) => p.trim());
    if (parts.length === 1) {
      // 单列时按链接处理（用户常直接粘 URL）
      out.push({ title: null, url: parts[0] || null, note: null });
      continue;
    }
    out.push({
      title: parts[0] || null,
      url: parts[1] || null,
      note: parts.slice(2).join(" | ") || null,
    });
  }
  return out;
}

function linesToArray(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

function toForm(p: ContentProjectRow): FormState {
  return {
    title: p.title,
    content_type: p.content_type,
    target_audience: p.target_audience ?? "",
    content_angle: p.content_angle ?? "",
    hook: p.hook ?? "",
    key_points: p.key_points.join("\n"),
    open_questions: p.open_questions.join("\n"),
    duration_seconds: p.duration_seconds === null ? "" : String(p.duration_seconds),
    video_form: p.video_form ?? "",
    production_notes: p.production_notes ?? "",
    status: p.status,
    reference_materials: materialsToText(p.reference_materials),
  };
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12px] font-medium text-[var(--color-text-secondary)]">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-[var(--color-text-muted)]">{hint}</span>}
    </label>
  );
}

/** 左侧策划表单：可编辑保存；「生成策划草稿」只在本地跑纯函数，不调 LLM、不改来源 */
export function PlanEditor({ project, source }: PlanEditorProps) {
  const router = useRouter();
  const initial = useMemo(() => toForm(project), [project]);
  const [form, setForm] = useState<FormState>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [generated, setGenerated] = useState(false);

  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setSaved(false);
  }

  function handleGenerate() {
    const plan = generateContentPlan({
      topicTitle: form.title,
      angle: source.angle,
      sourceMaterial: source.sourceMaterial,
      referenceVisuals: source.referenceVisuals,
    });
    setForm((f) => ({
      ...f,
      content_angle: plan.contentAngle,
      hook: plan.hook,
      key_points: plan.keyPoints.join("\n"),
      open_questions: plan.openQuestions.join("\n"),
      duration_seconds: String(plan.suggestedDuration),
      video_form: plan.videoForm,
    }));
    setGenerated(true);
    setSaved(false);
    setError(null);
  }

  async function handleSave() {
    if (saving) return;
    if (!form.title.trim()) {
      setError("标题不能为空");
      return;
    }
    const duration = form.duration_seconds.trim();
    const durationNumber = duration === "" ? null : Number(duration);
    if (durationNumber !== null && (!Number.isInteger(durationNumber) || durationNumber < 5 || durationNumber > 3600)) {
      setError("建议时长必须是 5-3600 之间的整数秒，或留空");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/content-projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title,
          content_type: form.content_type,
          target_audience: form.target_audience,
          content_angle: form.content_angle,
          hook: form.hook,
          key_points: linesToArray(form.key_points),
          open_questions: linesToArray(form.open_questions),
          duration_seconds: durationNumber,
          video_form: form.video_form,
          production_notes: form.production_notes,
          status: form.status,
          reference_materials: textToMaterials(form.reference_materials),
        }),
      });

      let data: { ok?: boolean; errors?: Record<string, string> } = {};
      try {
        data = await res.json();
      } catch {
        // 非 JSON 响应按失败处理
      }
      if (!res.ok || !data.ok) {
        throw new Error(Object.values(data.errors ?? {})[0] ?? "保存失败");
      }
      setSaved(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="glass-card p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-[15px] font-semibold text-[var(--color-text-primary)]">策划</h2>
          <p className="text-[12px] text-[var(--color-text-muted)] mt-1">
            只编辑策划字段；来源选题与来源日报由创建时确定，不可修改。
          </p>
        </div>
        <button
          type="button"
          onClick={handleGenerate}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-card)] text-[13px] text-[var(--color-text-secondary)] hover:border-[var(--color-border-glow)] hover:text-[var(--color-text-primary)] transition-colors"
        >
          <Sparkles size={14} />
          根据来源生成草稿
        </button>
      </div>

      {generated && (
        <p className="text-[12px] text-[var(--color-text-muted)] leading-relaxed rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-card)] px-3 py-2">
          已生成草稿（尚未保存）。生成只用选题原文逐句抽取，不补充事实、不添加链接；信息不足的项写在「待核实信息」里。
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label="标题">
          <input
            value={form.title}
            onChange={(e) => set("title", e.target.value)}
            className={inputClass}
            maxLength={200}
          />
        </Field>
        <Field label="内容类型">
          <select
            value={form.content_type}
            onChange={(e) => set("content_type", e.target.value as ContentType)}
            className={inputClass}
          >
            {CONTENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {CONTENT_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="项目阶段">
          <select
            value={form.status}
            onChange={(e) => set("status", e.target.value as ProjectStatus)}
            className={inputClass}
          >
            {PROJECT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label="目标受众">
          <input
            value={form.target_audience}
            onChange={(e) => set("target_audience", e.target.value)}
            className={inputClass}
            placeholder="例如：AI 从业者"
          />
        </Field>
        <Field label="建议时长（秒）" hint="5-3600，留空表示未定">
          <input
            value={form.duration_seconds}
            onChange={(e) => set("duration_seconds", e.target.value)}
            className={inputClass}
            inputMode="numeric"
            placeholder="例如：60"
          />
        </Field>
        <Field label="视频形式">
          <input
            value={form.video_form}
            onChange={(e) => set("video_form", e.target.value)}
            className={inputClass}
            placeholder="例如：口播 + 图文"
          />
        </Field>
      </div>

      <Field label="开场钩子（hook）">
        <textarea
          value={form.hook}
          onChange={(e) => set("hook", e.target.value)}
          className={textareaClass}
          rows={2}
        />
      </Field>

      <Field label="切入角度（content_angle）">
        <textarea
          value={form.content_angle}
          onChange={(e) => set("content_angle", e.target.value)}
          className={textareaClass}
          rows={3}
        />
      </Field>

      <Field label="核心观点（key_points）" hint="每行一条，导出后写入 JSON 数组">
        <textarea
          value={form.key_points}
          onChange={(e) => set("key_points", e.target.value)}
          className={textareaClass}
          rows={4}
        />
      </Field>

      <Field label="待核实信息（open_questions）" hint="每行一条；未核实的表述不得当作既定事实">
        <textarea
          value={form.open_questions}
          onChange={(e) => set("open_questions", e.target.value)}
          className={textareaClass}
          rows={3}
        />
      </Field>

      <Field
        label="参考素材（reference_materials）"
        hint="每行一条，格式：标题 | 链接 | 备注（链接和备注可省略）"
      >
        <textarea
          value={form.reference_materials}
          onChange={(e) => set("reference_materials", e.target.value)}
          className={textareaClass}
          rows={3}
          placeholder="Claude Code issue #107757 | https://github.com/... | 原始问题单"
        />
      </Field>

      <Field label="制作备注（production_notes）">
        <textarea
          value={form.production_notes}
          onChange={(e) => set("production_notes", e.target.value)}
          className={textareaClass}
          rows={2}
        />
      </Field>

      <div className="flex items-center gap-3 flex-wrap pt-1">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !dirty}
          className="inline-flex items-center gap-1.5 h-10 px-4 rounded-lg bg-[var(--color-accent)] text-white text-[13px] font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          保存策划
        </button>
        {dirty && !saved && (
          <span className="text-[12px] text-[var(--color-text-muted)]">有未保存的修改</span>
        )}
        {saved && <span className="text-[12px] text-[var(--color-success)]">已保存</span>}
        {error && <span className="text-[12px] text-[var(--color-danger)]">{error}</span>}
      </div>
    </section>
  );
}
