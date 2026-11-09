import Link from "next/link";
import { ArrowRight, Clock } from "lucide-react";
import { formatDateTime } from "@/lib/format";
import type { ContentProjectListItem } from "@/lib/content-projects-shared";
import { ContentTypeBadge, ProductionStatusBadge, ProjectStatusBadge } from "./Badges";

/**
 * 内容项目列表行（列表流形态）。
 * 原为三列卡片墙 —— 但项目数量级别是个位数到几十，卡片墙会留大片空白，
 * 且标题长度差异大导致卡片高度参差。横向行更稳。
 */
export function ProjectListRow({ project }: { project: ContentProjectListItem }) {
  return (
    <Link
      href={`/content/${project.id}`}
      className="group flex flex-col lg:flex-row lg:items-start gap-2 lg:gap-4 py-3 px-3 -mx-3 rounded-lg border-b border-[var(--color-border-subtle)] last:border-b-0 transition-colors hover:bg-[var(--color-bg-card-hover)]"
    >
      <div className="min-w-0 flex-1">
        <h3 className="text-[14px] font-semibold text-[var(--color-text-primary)] leading-snug min-w-0 [overflow-wrap:anywhere] group-hover:text-[var(--color-accent-light)] transition-colors">
          {project.title}
        </h3>
        {project.content_angle && (
          <p className="mt-1 text-[13px] text-[var(--color-text-muted)] leading-relaxed line-clamp-2 [overflow-wrap:anywhere]">
            <span className="text-[var(--color-text-secondary)]">角度：</span>
            {project.content_angle}
          </p>
        )}
        <div className="mt-1.5 flex items-center gap-3 text-[11px] text-[var(--color-text-muted)] flex-wrap">
          <span className="inline-flex items-center gap-1">
            <Clock size={11} />
            {formatDateTime(project.updated_at)}
          </span>
          <span>
            {project.source_idea_id ? `来源选题 #${project.source_idea_id}` : "手工项目"}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap lg:shrink-0 lg:justify-end">
        <ContentTypeBadge type={project.content_type} />
        <ProductionStatusBadge status={project.production_status} />
        <ProjectStatusBadge status={project.status} />
        <ArrowRight
          size={13}
          className="hidden lg:block text-[var(--color-text-muted)] group-hover:text-[var(--color-accent-light)] transition-colors"
        />
      </div>
    </Link>
  );
}
