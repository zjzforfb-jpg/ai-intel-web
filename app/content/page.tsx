import Link from "next/link";
import { Film, FolderOpen, SearchX } from "lucide-react";
import {
  countContentProjects,
  countContentProjectsByStatus,
  listContentProjects,
} from "@/lib/content-projects";
import { PROJECT_STATUSES, type ProjectStatus, isProjectStatus } from "@/lib/content-projects-shared";
import { DbErrorState } from "@/components/DbErrorState";
import { ProjectListRow } from "@/components/content/ProjectListRow";
import { PageHeader, PageBody } from "@/components/PageHeader";
import { dbHint } from "@/lib/config";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

const PAGE_SIZE = 12;

function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

export default async function ContentPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;

  const statusRaw = first(sp.status);
  const status: ProjectStatus | "" = isProjectStatus(statusRaw) ? statusRaw : "";
  const pageRaw = Number(first(sp.page) || "1");
  const page = Number.isInteger(pageRaw) && pageRaw > 0 ? pageRaw : 1;

  let result: Awaited<ReturnType<typeof listContentProjects>> | null = null;
  let totalAll = 0;
  let statusCounts: Record<string, number> = {};
  let dbError: string | null = null;

  try {
    [result, totalAll, statusCounts] = await Promise.all([
      listContentProjects({ status: status || null, page, size: PAGE_SIZE }),
      countContentProjects(),
      countContentProjectsByStatus(),
    ]);
  } catch (error) {
    dbError = error instanceof Error ? error.message : "数据库查询失败（未知错误）";
  }

  if (!result) {
    return (
      <DbErrorState
        title="无法读取内容项目"
        detail={dbError}
        hint={dbHint("any")}
      />
    );
  }

  const hasFilter = !!status;
  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));

  function filterHref(s: ProjectStatus | ""): string {
    return s ? `/content?status=${encodeURIComponent(s)}` : "/content";
  }

  function pageHref(p: number): string {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/content?${qs}` : "/content";
  }

  return (
    <PageBody>
      <PageHeader
        title="内容中心"
        subtitle={
          <>
            <span className="inline-flex items-center gap-1.5">
              <Film size={13} />
              共
              <span className="text-[var(--color-text-secondary)] font-medium tabular-nums">
                {totalAll}
              </span>
              个内容项目
            </span>
            {hasFilter && (
              <span>
                当前筛选命中
                <span className="text-[var(--color-text-secondary)] font-medium tabular-nums">
                  {result.total}
                </span>
                个
              </span>
            )}
            <span>从选题出发策划、导出到生产流水线、再回读结果</span>
          </>
        }
      />

      {/* 状态筛选：显示真实数量，不做假数据 */}
      <div className="flex items-center gap-2 flex-wrap">
        <Link
          href={filterHref("")}
          aria-pressed={!hasFilter}
          className={`chip ${!hasFilter ? "chip-active" : ""}`}
        >
          全部
          <span className="tabular-nums opacity-70 ml-1">{totalAll}</span>
        </Link>
        {PROJECT_STATUSES.map((s) => {
          const active = s === status;
          const n = statusCounts[s] ?? 0;
          return (
            <Link
              key={s}
              href={filterHref(s)}
              aria-pressed={active}
              className={`chip ${active ? "chip-active" : ""}`}
            >
              {s}
              <span className="tabular-nums opacity-70 ml-1">{n}</span>
            </Link>
          );
        })}
      </div>

      {result.items.length > 0 ? (
        <>
          <div className="card-l flex flex-col">
            {result.items.map((p) => (
              <ProjectListRow key={p.id} project={p} />
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-2">
              {page > 1 && (
                <Link
                  href={pageHref(page - 1)}
                  className="btn-secondary h-8"
                >
                  上一页
                </Link>
              )}
              <span className="text-[13px] text-[var(--color-text-muted)] tabular-nums">
                {page} / {totalPages}
              </span>
              {page < totalPages && (
                <Link
                  href={pageHref(page + 1)}
                  className="btn-secondary h-8"
                >
                  下一页
                </Link>
              )}
            </div>
          )}
        </>
      ) : hasFilter ? (
        <div className="empty-state">
          <SearchX size={26} className="text-[var(--color-text-muted)]" />
          <p className="text-[14px] text-[var(--color-text-secondary)]">
            没有处于「{status}」的内容项目
          </p>
          <p className="text-[13px] text-[var(--color-text-muted)]">换个状态看看，或查看全部项目。</p>
          <Link href="/content" className="btn-secondary mt-1">
            查看全部
          </Link>
        </div>
      ) : (
        <div className="empty-state">
          <FolderOpen size={26} className="text-[var(--color-text-muted)]" />
          <p className="text-[14px] text-[var(--color-text-secondary)]">还没有内容项目</p>
          <p className="text-[13px] text-[var(--color-text-muted)] leading-relaxed">
            内容项目从选题创建：到
            <Link href="/ideas" className="text-[var(--color-link)] hover:underline mx-1">
              短视频选题
            </Link>
            里挑一条，点「创建内容项目」。
          </p>
        </div>
      )}
    </PageBody>
  );
}
