"use client";

import { AlertTriangle, RotateCw } from "lucide-react";

/** 全局错误边界：任何未捕获的服务端/客户端异常都给出明确提示，不显示空白页 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="px-4 sm:px-6 py-16 max-w-2xl mx-auto">
      <div className="glass-card p-8 text-center">
        <div className="w-14 h-14 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-4">
          <AlertTriangle size={26} className="text-red-400" />
        </div>
        <h1 className="text-lg font-semibold text-[var(--color-text-primary)] mb-2">
          页面加载出错
        </h1>
        <p className="text-sm text-[var(--color-text-secondary)] mb-3">
          渲染该页面时发生异常，数据未被修改。可尝试重新加载。
        </p>
        {error.message && (
          <p className="text-xs text-[var(--color-text-muted)] font-mono break-all mb-6">
            {error.message}
          </p>
        )}
        <button
          onClick={reset}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm bg-[var(--color-accent)] text-white hover:opacity-90 transition-opacity"
        >
          <RotateCw size={14} />
          重试
        </button>
      </div>
    </div>
  );
}
