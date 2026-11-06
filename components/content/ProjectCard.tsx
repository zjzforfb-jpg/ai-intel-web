import Link from "next/link";
import { ArrowRight, Clock } from "lucide-react";
import { formatDateTime } from "@/lib/format";
import type { ContentProjectListItem } from "@/lib/content-projects-shared";
import { ContentTypeBadge, ProductionStatusBadge, ProjectStatusBadge } from "./Badges";

/** 内容项目卡片：标题 + 类型/阶段 + 来源选题 + 更新时间 */
export function ProjectCard({ project }: { project: ContentProjectListItem }) {
  return (
    <Link
      href={`/content/${project.id}`}
      className="glass-card p-4 flex flex-col gap-2.5 group"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-[15px] font-semibold text-[var(--color-text-primary)] leading-snug min-w-0 [overflow-wrap:anywhere] group-hover:text-[var(--color-accent-light)] transition-colors">
          {project.title}
        </h3>
        <ProjectStatusBadge status={project.status} />
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <ContentTypeBadge type={project.content_type} />
        <ProductionStatusBadge status={project.production_status} />
      </div>

      {project.content_angle && (
        <p className="text-[13px] text-[var(--color-text-muted)] leading-relaxed line-clamp-2 [overflow-wrap:anywhere]">
          <span className="text-[var(--color-text-secondary)]">角度：</span>
          {project.content_angle}
        </p>
      )}

      <div className="flex items-center justify-between gap-2 pt-2 border-t border-[var(--color-border-subtle)] mt-auto">
        <span className="text-[12px] text-[var(--color-text-muted)] inline-flex items-center gap-1.5">
          <Clock size={12} />
          {formatDateTime(project.updated_at)}
        </span>
        <span className="text-[12px] text-[var(--color-text-muted)] inline-flex items-center gap-1">
          {project.source_idea_id ? `来源选题 #${project.source_idea_id}` : "手工项目"}
          <ArrowRight size={12} />
        </span>
      </div>
    </Link>
  );
}
