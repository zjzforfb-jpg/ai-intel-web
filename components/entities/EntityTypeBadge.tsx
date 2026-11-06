import type { EntityType } from "@/lib/entities-extract";

/** 实体类型 → 中文标签 */
export const ENTITY_TYPE_LABEL: Record<EntityType, string> = {
  company: "公司",
  person: "人物",
  ai_product: "AI 产品",
  technology: "技术",
  open_source: "开源项目",
  organization: "机构",
  unknown: "待确认",
};

/** 徽章配色（沿用商业机会状态徽章的低饱和描边风格） */
const TYPE_CLASS: Record<EntityType, string> = {
  company: "bg-sky-500/15 text-sky-400 border-sky-500/30",
  person: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  ai_product: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",
  technology: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  open_source: "bg-teal-500/15 text-teal-400 border-teal-500/30",
  organization: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  unknown: "bg-gray-500/15 text-gray-400 border-gray-500/30",
};

interface EntityTypeBadgeProps {
  type: EntityType;
  className?: string;
}

/** 实体类型徽章 */
export function EntityTypeBadge({ type, className }: EntityTypeBadgeProps) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[12px] font-medium whitespace-nowrap ${TYPE_CLASS[type]} ${className ?? ""}`}
    >
      {ENTITY_TYPE_LABEL[type]}
    </span>
  );
}
