import type { ReactNode } from "react";

/**
 * 统一页头：标题 + 副标题 + 右侧动作区。
 *
 * 全站 17 页原来各写各的标题块，字号/间距/动作区位置都不一致。
 * 收敛到这里后，各页只提供内容。
 */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 flex-wrap">
      <div className="min-w-0">
        <h1 className="text-[22px] lg:text-[24px] font-bold text-[var(--color-text-primary)] leading-tight">
          {title}
        </h1>
        {subtitle && (
          <div className="mt-1 text-[13px] text-[var(--color-text-muted)] flex items-center gap-3 flex-wrap">
            {subtitle}
          </div>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

/** 页面内容区：统一内边距与区块间距 */
export function PageBody({ children }: { children: ReactNode }) {
  return (
    <div className="px-4 sm:px-6 lg:px-8 py-5 flex flex-col gap-4">
      {children}
    </div>
  );
}
