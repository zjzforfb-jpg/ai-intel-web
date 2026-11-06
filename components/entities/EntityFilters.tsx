import Link from "next/link";
import { Search, X } from "lucide-react";
import { ENTITY_TYPES, type EntityType } from "@/lib/entities-extract";
import { ENTITY_TYPE_LABEL } from "./EntityTypeBadge";
import { entitiesHref } from "./entity-links";

interface EntityFiltersProps {
  q: string;
  types: EntityType[];
  days: 7 | 30;
}

/**
 * 实体筛选：搜索框（GET 表单）+ 类型多选 + 7/30 天热度窗口
 * 所有状态都在 URL query 中，服务端渲染即可直接命中数据库。
 */
export function EntityFilters({ q, types, days }: EntityFiltersProps) {
  /** 切换某个类型（保留搜索与窗口条件） */
  function toggleType(type: EntityType): string {
    const next = types.includes(type) ? types.filter((t) => t !== type) : [...types, type];
    return entitiesHref({ q, types: next, days });
  }

  return (
    <div className="glass-card p-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <form action="/entities" method="get" className="flex items-center gap-2 flex-1 min-w-[220px]">
          {types.length > 0 && <input type="hidden" name="type" value={types.join(",")} />}
          {days === 30 && <input type="hidden" name="days" value="30" />}
          <div className="relative flex-1 min-w-0">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]"
              aria-hidden
            />
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="搜索实体名称或别名，如 OpenAI / 英伟达"
              aria-label="搜索实体"
              className="w-full h-9 pl-8 pr-3 rounded-lg bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] text-[13px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-border-glow)] focus:outline-none transition-colors"
            />
          </div>
          <button
            type="submit"
            className="h-9 px-3.5 rounded-lg bg-[var(--color-accent)] text-white text-[13px] font-medium hover:opacity-90 transition-opacity shrink-0"
          >
            搜索
          </button>
        </form>

        {q && (
          <Link
            href={entitiesHref({ types, days })}
            className="inline-flex items-center gap-1 h-9 px-3 rounded-lg border border-[var(--color-border-subtle)] text-[13px] text-[var(--color-text-muted)] hover:border-[var(--color-border-glow)] hover:text-[var(--color-text-secondary)] transition-all"
          >
            <X size={13} />
            清除搜索
          </Link>
        )}

        {/* 热度窗口 */}
        <div className="inline-flex items-center gap-1 p-1 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)]">
          {([7, 30] as const).map((d) => (
            <Link
              key={d}
              href={entitiesHref({ q, types, days: d })}
              aria-pressed={days === d}
              className={`px-2.5 py-1 rounded-md text-[13px] font-medium transition-all ${
                days === d
                  ? "bg-[var(--color-accent)] text-white"
                  : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
              }`}
            >
              近 {d} 天
            </Link>
          ))}
        </div>
      </div>

      {/* 类型多选 */}
      <div className="flex items-center gap-2 flex-wrap">
        {ENTITY_TYPES.map((type) => {
          const active = types.includes(type);
          return (
            <Link
              key={type}
              href={toggleType(type)}
              aria-pressed={active}
              className={`px-2.5 py-1 rounded-full border text-[13px] transition-all ${
                active
                  ? "border-[var(--color-accent)] bg-[var(--color-accent-glow)] text-[var(--color-accent-light)] font-medium"
                  : "border-[var(--color-border-subtle)] text-[var(--color-text-muted)] hover:border-[var(--color-border-glow)] hover:text-[var(--color-text-secondary)]"
              }`}
            >
              {ENTITY_TYPE_LABEL[type]}
            </Link>
          );
        })}
        {types.length > 0 && (
          <Link
            href={entitiesHref({ q, days })}
            className="text-[13px] text-[var(--color-text-muted)] hover:text-[var(--color-accent-light)] transition-colors"
          >
            清除类型
          </Link>
        )}
      </div>
    </div>
  );
}
