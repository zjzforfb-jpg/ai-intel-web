import type { TopicCategory } from "@/lib/db-write";

/** 四种分类的配色（完整类名，保证 Tailwind 扫描生成） */
const CATEGORY_STYLES: Record<TopicCategory, string> = {
  公司: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",
  模型: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  产品: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  技术: "bg-amber-500/15 text-amber-300 border-amber-500/30",
};

/** 专题分类徽标 */
export function CategoryBadge({ category }: { category: TopicCategory }) {
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[13px] font-medium ${CATEGORY_STYLES[category]}`}
    >
      {category}
    </span>
  );
}
