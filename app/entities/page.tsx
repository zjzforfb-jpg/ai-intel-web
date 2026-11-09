import Link from "next/link";
import { Boxes, SearchX, Sparkles } from "lucide-react";
import { listEntities, normalizeDays, normalizeTypes } from "@/lib/entities";
import { DbErrorState } from "@/components/DbErrorState";
import { PageHeader, PageBody } from "@/components/PageHeader";
import { EntityFilters } from "@/components/entities/EntityFilters";
import { EntityTable } from "@/components/entities/EntityTable";
import { EntityPagination } from "@/components/entities/EntityPagination";
import { dbHint } from "@/lib/config";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "实体追踪 | 每日 AI 情报内参",
  description: "受控词典抽取的 AI 行业实体及其历史提及。",
};

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

/** 取查询参数的首个字符串值 */
function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

/** 解析页码：非法值一律回到第 1 页 */
function parsePage(raw: string): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.trunc(n) : 1;
}

export default async function EntitiesPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const q = first(sp.q).trim();
  const types = normalizeTypes(
    first(sp.type)
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
  );
  const days = normalizeDays(Number(first(sp.days)) || 7);
  const page = parsePage(first(sp.page));

  let result: Awaited<ReturnType<typeof listEntities>> | null = null;
  let dbError: string | null = null;
  try {
    result = await listEntities({ q, types, days, page, size: 20 });
  } catch (error) {
    dbError = error instanceof Error ? error.message : "数据库查询失败（未知错误）";
  }

  if (!result) {
    return (
      <DbErrorState
        title="无法读取实体列表"
        detail={dbError}
        hint={dbHint("reader")}
      />
    );
  }

  const hasFilter = !!q || types.length > 0 || days !== 7;

  return (
    <PageBody>
      <PageHeader
        title="实体追踪"
        subtitle={
          <>
            <span className="inline-flex items-center gap-1.5">
              <Boxes size={13} />
              共
              <span className="text-[var(--color-text-secondary)] font-medium tabular-nums">
                {result.total}
              </span>
              个实体
            </span>
            {hasFilter && (
              <span>
                当前筛选命中
                <span className="text-[var(--color-text-secondary)] font-medium tabular-nums">
                  {result.items.length}
                </span>
                个
              </span>
            )}
            <span className="inline-flex items-center gap-1.5">
              <Sparkles size={13} />
              受控词典 + 规则抽取，不调用模型；每条提及都定位到具体头条与原文链接
            </span>
          </>
        }
      />

      <EntityFilters q={q} types={types} days={days} />

      {result.items.length > 0 ? (
        <>
          <EntityTable items={result.items} days={days} />
          <EntityPagination
            page={result.page}
            total={result.total}
            size={result.size}
            query={{ q, types, days }}
          />
        </>
      ) : hasFilter ? (
        <div className="empty-state">
          <SearchX size={26} className="text-[var(--color-text-muted)]" />
          <p className="text-[14px] text-[var(--color-text-secondary)]">
            没有符合筛选条件的实体
          </p>
          <p className="text-[13px] text-[var(--color-text-muted)]">
            试试更换关键词、类型或热度窗口。
          </p>
          <Link href="/entities" className="btn-secondary mt-1">
            查看全部实体
          </Link>
        </div>
      ) : (
        <div className="empty-state">
          <Boxes size={26} className="text-[var(--color-text-muted)]" />
          <p className="text-[14px] text-[var(--color-text-secondary)]">尚未抽取到实体</p>
          <p className="text-[13px] text-[var(--color-text-muted)] max-w-xl leading-relaxed">
            实体提及由日报入库后的规则抽取写入（受控词典，不调用模型）。
            当前数据库中没有实体记录，请先确认 n8n 日报链路已生成日报，再执行实体抽取。
          </p>
        </div>
      )}
    </PageBody>
  );
}
