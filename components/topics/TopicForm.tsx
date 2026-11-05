"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2, Plus, X } from "lucide-react";
import type { TopicCategory } from "@/lib/db-write";
import {
  TOPIC_CATEGORIES,
  TOPIC_DESC_MAX,
  TOPIC_KEYWORDS_MAX,
  TOPIC_NAME_MAX,
  isTopicCategory,
  parseTopicKeywords,
  validateTopicInput,
  type TopicFieldErrors,
} from "@/lib/topics-input";
import { createTopicAction, updateTopicAction } from "@/lib/topics-actions";

const CATEGORY_BUTTON_STYLES: Record<TopicCategory, string> = {
  公司: "border-indigo-500/50 bg-indigo-500/15 text-indigo-200",
  模型: "border-sky-500/50 bg-sky-500/15 text-sky-200",
  产品: "border-emerald-500/50 bg-emerald-500/15 text-emerald-200",
  技术: "border-amber-500/50 bg-amber-500/15 text-amber-200",
};

const inputClass =
  "w-full rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-card)] px-3 py-2 text-[14px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none";

interface TopicFormProps {
  mode: "create" | "edit";
  topicId?: number;
  initial?: {
    name: string;
    category: TopicCategory;
    keywords: string[];
    description: string | null;
  };
}

/** 专题创建 / 编辑表单（两模式共用），提交走 Server Actions */
export function TopicForm({ mode, topicId, initial }: TopicFormProps) {
  const router = useRouter();
  const [name, setName] = useState(initial?.name ?? "");
  const [category, setCategory] = useState<TopicCategory>(initial?.category ?? "公司");
  const [keywords, setKeywords] = useState<string[]>(initial?.keywords ?? []);
  const [kwInput, setKwInput] = useState("");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [fieldErrors, setFieldErrors] = useState<TopicFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function addKeywords(raw: string) {
    const parsed = parseTopicKeywords(raw);
    if (parsed.length === 0) return;
    setKeywords((prev) => {
      const seen = new Set(prev.map((k) => k.toLowerCase()));
      const next = [...prev];
      for (const k of parsed) {
        const key = k.toLowerCase();
        if (seen.has(key)) continue;
        if (next.length >= TOPIC_KEYWORDS_MAX) break;
        seen.add(key);
        next.push(k);
      }
      return next;
    });
    setKwInput("");
    setFieldErrors((prev) => ({ ...prev, keywords: undefined }));
  }

  function removeKeyword(k: string) {
    setKeywords((prev) => prev.filter((x) => x !== k));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const validated = validateTopicInput({ name, category, keywords, description });
    if (!validated.ok) {
      setFieldErrors(validated.fieldErrors);
      setFormError("表单校验未通过，请检查标红的字段");
      return;
    }
    setFieldErrors({});
    setFormError(null);

    const payload = {
      name: validated.value.name,
      category: validated.value.category,
      keywords: validated.value.keywords.join(","),
      description: validated.value.description ?? "",
    };

    startTransition(async () => {
      const result =
        mode === "edit" && topicId !== undefined
          ? await updateTopicAction(topicId, payload)
          : await createTopicAction(payload);
      if (result.ok) {
        router.push(`/topics/${result.id}`);
        router.refresh();
      } else {
        setFormError(result.message);
        if (result.fieldErrors) setFieldErrors(result.fieldErrors);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="glass-card p-5 sm:p-6 flex flex-col gap-5 max-w-2xl">
      {/* 专题名称 */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="topic-name" className="text-[13px] font-medium text-[var(--color-text-secondary)]">
          专题名称 <span className="text-red-400">*</span>
        </label>
        <input
          id="topic-name"
          type="text"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setFieldErrors((prev) => ({ ...prev, name: undefined }));
          }}
          placeholder="例如：OpenAI 动态追踪"
          maxLength={TOPIC_NAME_MAX}
          disabled={pending}
          className={inputClass}
        />
        {fieldErrors.name && <p className="text-[13px] text-red-400">{fieldErrors.name}</p>}
      </div>

      {/* 分类 */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-[var(--color-text-secondary)]">
          分类 <span className="text-red-400">*</span>
        </span>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="专题分类">
          {TOPIC_CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={category === c}
              onClick={() => {
                setCategory(c);
                setFieldErrors((prev) => ({ ...prev, category: undefined }));
              }}
              disabled={pending}
              className={`rounded-lg border px-3.5 py-1.5 text-[13px] transition-all ${
                category === c
                  ? CATEGORY_BUTTON_STYLES[c]
                  : "border-[var(--color-border-subtle)] bg-[var(--color-bg-card)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-glow)]"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
        {fieldErrors.category && <p className="text-[13px] text-red-400">{fieldErrors.category}</p>}
      </div>

      {/* 关键词 */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="topic-keywords" className="text-[13px] font-medium text-[var(--color-text-secondary)]">
          关键词
        </label>
        <p className="text-[13px] text-[var(--color-text-muted)]">
          用于自动关联历史日报：在日报标题与正文中做子串匹配（多个关键词需同时命中）。
          支持逗号或空格分隔批量添加，最多 {TOPIC_KEYWORDS_MAX} 个。
        </p>
        <div className="flex gap-2">
          <input
            id="topic-keywords"
            type="text"
            value={kwInput}
            onChange={(e) => setKwInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addKeywords(kwInput);
              }
            }}
            placeholder="输入关键词后回车添加，例如：OpenAI GPT-5"
            disabled={pending || keywords.length >= TOPIC_KEYWORDS_MAX}
            className={inputClass}
          />
          <button
            type="button"
            onClick={() => addKeywords(kwInput)}
            disabled={pending || !kwInput.trim() || keywords.length >= TOPIC_KEYWORDS_MAX}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-card)] px-3 py-2 text-[13px] text-[var(--color-text-secondary)] hover:border-[var(--color-border-glow)] disabled:opacity-50"
          >
            <Plus size={15} />
            添加
          </button>
        </div>
        {keywords.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-1">
            {keywords.map((k) => (
              <span
                key={k}
                className="inline-flex max-w-full items-center gap-1 rounded-md border border-[var(--color-border-glow)] bg-[var(--color-accent-glow)] px-2 py-0.5 text-[13px] text-[var(--color-accent-light)]"
              >
                <span className="break-all">{k}</span>
                <button
                  type="button"
                  onClick={() => removeKeyword(k)}
                  disabled={pending}
                  aria-label={`移除关键词 ${k}`}
                  className="shrink-0 rounded hover:bg-white/10"
                >
                  <X size={13} />
                </button>
              </span>
            ))}
          </div>
        )}
        <p className="text-[13px] text-[var(--color-text-muted)]">
          已添加 {keywords.length} / {TOPIC_KEYWORDS_MAX} 个
        </p>
        {fieldErrors.keywords && <p className="text-[13px] text-red-400">{fieldErrors.keywords}</p>}
      </div>

      {/* 描述 */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="topic-desc" className="text-[13px] font-medium text-[var(--color-text-secondary)]">
          描述
        </label>
        <textarea
          id="topic-desc"
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
            setFieldErrors((prev) => ({ ...prev, description: undefined }));
          }}
          placeholder="这个专题关注什么？（选填）"
          rows={4}
          maxLength={TOPIC_DESC_MAX}
          disabled={pending}
          className={`${inputClass} resize-y`}
        />
        <p className="text-[13px] text-[var(--color-text-muted)]">
          {description.length} / {TOPIC_DESC_MAX} 字
        </p>
        {fieldErrors.description && <p className="text-[13px] text-red-400">{fieldErrors.description}</p>}
      </div>

      {/* 提交区 */}
      {formError && (
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[13px] text-red-300">
          {formError}
        </p>
      )}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-lg bg-[var(--color-accent)] px-4 py-2 text-[13px] text-white hover:opacity-90 transition-opacity disabled:opacity-60"
        >
          {pending && <Loader2 size={15} className="animate-spin" />}
          {mode === "edit" ? "保存修改" : "创建专题"}
        </button>
        <Link
          href={mode === "edit" && topicId !== undefined ? `/topics/${topicId}` : "/topics"}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-card)] px-4 py-2 text-[13px] text-[var(--color-text-secondary)] hover:border-[var(--color-border-glow)] transition-all"
        >
          <ArrowLeft size={15} />
          取消
        </Link>
      </div>
    </form>
  );
}
