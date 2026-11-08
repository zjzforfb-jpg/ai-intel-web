import Link from "next/link";
import { Film, FolderOpen, SearchX } from "lucide-react";
import {
  countContentProjects,
  countContentProjectsByStatus,
  listContentProjects,
} from "@/lib/content-projects";
import { PROJECT_STATUSES, type ProjectStatus, isProjectStatus } from "@/lib/content-projects-shared";
import { DbErrorState } from "@/components/DbErrorState";
import { ProjectCard } from "@/components/content/ProjectCard";
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
    <div className="px-4 sm:px-6 lg:px-8 py-5 flex flex-col gap-4">
      <div>
        <h1 className="text-[22px] lg:text-[24px] font-bold text-[var(--color-text-primary)] mb-1">
          内容中心
        </h1>
        <p className="text-[13px] text-[var(--color-text-muted)] flex items-center gap-3 flex-wrap">
          <span className="inline-flex items-center gap-1.5">
            <Film size={13} />
            共{" "}
            <span className="text-[var(--color-text-secondary)] font-medium tabular-nums">
              {totalAll}
            </span>{" "}
            个内容项目
          </span>
          {hasFilter && (
            <span>
              当前筛选命中{" "}
              <span className="text-[var(--color-text-secondary)] font-medium tabular-nums">
                {result.total}
              </span>{" "}
              个
            </span>
          )}
          <span>从选题出发策划、导出到生产流水线、再回读结果</span>
        </p>
      </div>

      {/* 状态筛选：显示真实数量，不做假数据 */}
      <div className="flex items-center gap-2 flex-wrap">
        <Link
          href={filterHref("")}
          aria-pressed={!hasFilter}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[13px] font-medium transition-all ${
            !hasFilter
              ? "bg-[var(--color-accent)] text-white border-transparent"
              : "border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-glow)] hover:text-[var(--color-text-primary)]"
          }`}
        >
          全部
          <span className="tabular-nums opacity-70">{totalAll}</span>
        </Link>
        {PROJECT_STATUSES.map((s) => {
          const active = s === status;
          const n = statusCounts[s] ?? 0;
          return (
            <Link
              key={s}
              href={filterHref(s)}
              aria-pressed={active}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[13px] font-medium transition-all ${
                active
                  ? "bg-[var(--color-accent)] text-white border-transparent"
                  : "border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-glow)] hover:text-[var(--color-text-primary)]"
              }`}
            >
              {s}
              <span className="tabular-nums opacity-70">{n}</span>
            </Link>
          );
        })}
      </div>

      {result.items.length > 0 ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {result.items.map((p) => (
              <ProjectCard key={p.id} project={p} />
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-2">
              {page > 1 && (
                <Link
                  href={pageHref(page - 1)}
                  className="inline-flex items-center h-8 px-3 rounded-lg border border-[var(--color-border-subtle)] text-[13px] text-[var(--color-text-secondary)] hover:border-[var(--color-border-glow)]"
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
                  className="inline-flex items-center h-8 px-3 rounded-lg border border-[var(--color-border-subtle)] text-[13px] text-[var(--color-text-secondary)] hover:border-[var(--color-border-glow)]"
                >
                  下一页
                </Link>
              )}
            </div>
          )}
        </>
      ) : hasFilter ? (
        <div className="glass-card p-10 text-center">
          <SearchX size={28} className="text-[var(--color-text-muted)] mx-auto mb-3" />
          <p className="text-base text-[var(--color-text-secondary)] mb-1">
            没有处于「{status}」的内容项目
          </p>
          <p className="text-[13px] text-[var(--color-text-muted)] mb-5">换个状态看看，或查看全部项目。</p>
          <Link
            href="/content"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-bg-card)] border border-[var(--color-border-subtle)] text-[13px] text-[var(--color-text-secondary)] hover:border-[var(--color-border-glow)] hover:text-[var(--color-text-primary)] transition-all"
          >
            查看全部
          </Link>
        </div>
      ) : (
        <div className="glass-card p-10 text-center">
          <FolderOpen size={28} className="text-[var(--color-text-muted)] mx-auto mb-3" />
          <p className="text-base text-[var(--color-text-secondary)] mb-1">还没有内容项目</p>
          <p className="text-[13px] text-[var(--color-text-muted)] leading-relaxed">
            内容项目从选题创建：到
            <Link href="/ideas" className="text-[var(--color-link)] hover:underline mx-1">
              短视频选题
            </Link>
            里挑一条，点「创建内容项目」。
          </p>
        </div>
      )}
    </div>
  );
}
