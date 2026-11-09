import type { CSSProperties } from "react";
import { IDEA_STATUS_COLOR_VAR_NAME, type IdeaStatus } from "@/lib/ideas-shared";

/**
 * 选题状态徽章：颜色走主题令牌（--color-status-*），暗黑 / 暖风自动适配。
 * 用 style 注入 CSS 变量，徽章内部样式不依赖任何硬编码色值。
 */
export function StatusBadge({
  status,
  className = "",
}: {
  status: IdeaStatus;
  className?: string;
}) {
  const style = {
    "--status-color": `var(${IDEA_STATUS_COLOR_VAR_NAME[status]})`,
  } as CSSProperties;

  return (
    <span className={`status-badge ${className}`} style={style}>
      <span className="status-dot" aria-hidden />
      {status}
    </span>
  );
}
