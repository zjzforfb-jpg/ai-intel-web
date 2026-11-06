// 内容中心 —— 状态/类型徽章（纯展示，服务端可用）
import {
  CONTENT_TYPE_BADGE_CLASS,
  CONTENT_TYPE_LABELS,
  PRODUCTION_STATUS_BADGE_CLASS,
  PROJECT_STATUS_BADGE_CLASS,
  type ContentType,
  type ProductionStatus,
  type ProjectStatus,
} from "@/lib/content-projects-shared";

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full border text-[12px] font-medium ${PROJECT_STATUS_BADGE_CLASS[status]}`}
    >
      {status}
    </span>
  );
}

export function ProductionStatusBadge({ status }: { status: ProductionStatus }) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full border text-[12px] font-medium ${PRODUCTION_STATUS_BADGE_CLASS[status]}`}
    >
      {status}
    </span>
  );
}

export function ContentTypeBadge({ type }: { type: ContentType }) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full border text-[12px] font-medium ${CONTENT_TYPE_BADGE_CLASS[type]}`}
    >
      {CONTENT_TYPE_LABELS[type]}
    </span>
  );
}
