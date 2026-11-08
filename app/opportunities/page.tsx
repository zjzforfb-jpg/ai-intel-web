import Link from "next/link";
import { Briefcase, Eraser, Lightbulb, SearchX } from "lucide-react";
import { listOpportunities, getOpportunityFacets } from "@/lib/opportunities";
import {
  isOpportunityStatus,
  type OpportunityStatus,
} from "@/lib/opportunities-shared";
import { DbErrorState } from "@/components/DbErrorState";
import { CreateOpportunitySection } from "@/components/opportunities/CreateOpportunitySection";
import { OpportunityFilters } from "@/components/opportunities/OpportunityFilters";
import { OpportunityListCard } from "@/components/opportunities/OpportunityListCard";
import { OpportunityPagination } from "@/components/opportunities/OpportunityPagination";
import { dbHint } from "@/lib/config";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

/** 取查询参数的首个字符串值 */
function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

function sanitizePage(v: string): number {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 100000 ? n : 1;
}

export default async function OpportunitiesPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;

  // 非法状态一律忽略（不把非法值传给数据库）
  const statusRaw = first(sp.status);
  const status: OpportunityStatus | "" = isOpportunityStatus(statusRaw) ? statusRaw : "";
  const category = first(sp.category).trim().slice(0, 100);
  const page = sanitizePage(first(sp.page));

  let list: Awaited<ReturnType<typeof listOpportunities>> | null = null;
  let facets: Awaited<ReturnType<typeof getOpportunityFacets>> | null = null;
  let dbError: string | null = null;

  try {
    [list, facets] = await Promise.all([
      listOpportunities({ status: status || null, category: category || null, page }),
      getOpportunityFacets({ status: status || null, category: category || null }),
    ]);
  } catch (error) {
    dbError = error instanceof Error ? error.message : "数据库查询失败（未知错误）";
  }

  if (!list || !facets) {
    return (
      <DbErrorState
        title="无法读取商业机会"
        detail={dbError}
        hint={dbHint("any")}
      />
    );
  }

  const hasFilter = !!(status || category);
  const knownCategories = facets.categories.map((c) => c.category);

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-5 flex flex-col gap-4">
      {/* 页头 */}
      <div>
        <h1 className="text-[22px] lg:text-[24px] font-bold text-[var(--color-text-primary)] mb-1">
          商业机会管理
        </h1>
        <p className="text-[13px] text-[var(--color-text-muted)] flex items-center gap-3 flex-wrap">
          <span className="inline-flex items-center gap-1.5">
            <Briefcase size={13} />
            共{" "}
            <span className="text-[var(--color-text-secondary)] font-medium tabular-nums">
              {facets.total}
            </span>{" "}
            条机会
          </span>
          {hasFilter && (
            <span>
              当前筛选命中{" "}
              <span className="text-[var(--color-text-secondary)] font-medium tabular-nums">
                {list.total}
              </span>{" "}
              条
            </span>
          )}
          <span>把日报中发现的商业机会归档到这里，跟踪验证与实施进度</span>
        </p>
      </div>

      {/* 新建 */}
      <CreateOpportunitySection knownCategories={knownCategories} />

      {/* 状态 / 分类筛选（条件进 URL query） */}
      <OpportunityFilters
        total={facets.total}
        statusCounts={facets.statusCounts}
        categories={facets.categories}
        currentStatus={status}
        currentCategory={category}
      />

      {/* 机会列表 */}
      {list.items.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {list.items.map((item) => (
            <OpportunityListCard key={item.id} item={item} />
          ))}
        </div>
      ) : hasFilter ? (
        <div className="glass-card p-10 text-center">
          <SearchX size={28} className="text-[var(--color-text-muted)] mx-auto mb-3" />
          <p className="text-base text-[var(--color-text-secondary)] mb-1">
            没有符合筛选条件的机会
          </p>
          <p className="text-[13px] text-[var(--color-text-muted)] mb-5">
            试试更换状态 / 分类条件，或清除筛选查看全部。
          </p>
          <Link
            href="/opportunities"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-bg-card)] border border-[var(--color-border-subtle)] text-[13px] text-[var(--color-text-secondary)] hover:border-[var(--color-border-glow)] hover:text-[var(--color-text-primary)] transition-all"
          >
            <Eraser size={14} />
            清除筛选
          </Link>
        </div>
      ) : (
        <div className="glass-card p-10 text-center">
          <Lightbulb size={28} className="text-[var(--color-text-muted)] mx-auto mb-3" />
          <p className="text-base text-[var(--color-text-secondary)] mb-1">
            还没有归档的商业机会
          </p>
          <p className="text-[13px] text-[var(--color-text-muted)]">
            阅读日报时发现的商业机会，可以点右上角「新建机会」录入这里，持续跟踪验证进度。
          </p>
        </div>
      )}

      {/* 分页（保留筛选条件） */}
      <OpportunityPagination
        page={list.page}
        totalPages={list.totalPages}
        baseQuery={{ status, category }}
      />
    </div>
  );
}
