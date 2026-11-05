import Link from "next/link";
import { AlertTriangle, ArrowLeft, RotateCw } from "lucide-react";

interface DbErrorStateProps {
  /** 场景标题，例如「无法读取情报数据」 */
  title: string;
  detail?: string | null;
  /** 补充排查提示 */
  hint?: string;
}

/**
 * 数据库异常时的统一错误态（服务端组件）
 * 明确区分「读取失败」与「确实没有数据」，绝不渲染伪造内容
 */
export function DbErrorState({ title, detail, hint }: DbErrorStateProps) {
  return (
    <div className="px-4 sm:px-6 py-16 max-w-2xl mx-auto">
      <div className="glass-card p-8 text-center">
        <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto mb-4">
          <AlertTriangle size={26} className="text-[var(--color-warning)]" />
        </div>
        <h1 className="text-lg font-semibold text-[var(--color-text-primary)] mb-2">{title}</h1>
        <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed mb-3">
          后端未能连接到 PostgreSQL 数据库。这是读取失败，不代表当天没有日报，请勿据此判断数据缺失。
        </p>
        {detail && (
          <p className="text-xs text-[var(--color-text-muted)] font-mono break-all mb-3">
            {detail}
          </p>
        )}
        <p className="text-xs text-[var(--color-text-muted)] mb-6">
          {hint ??
            "可检查：Docker 中 n8n-radar-postgres 是否在运行、127.0.0.1:5433 是否可连、只读账号凭据是否有效。"}
        </p>
        <div className="flex items-center justify-center gap-3 flex-wrap">
          <a
            href=""
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm bg-[var(--color-accent)] text-white hover:opacity-90 transition-opacity"
          >
            <RotateCw size={14} />
            重新加载
          </a>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm bg-[var(--color-bg-card)] border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-glow)] transition-all"
          >
            <ArrowLeft size={14} />
            返回首页
          </Link>
        </div>
      </div>
    </div>
  );
}
