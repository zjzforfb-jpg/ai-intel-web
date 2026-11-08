"use client";

import { RefreshCw, Database, AlertCircle } from "lucide-react";
import { useState, useEffect } from "react";

interface TopBarProps {
  displayTz: string;
}

/** 健康探针轮询间隔：60s。DB 状态是"信任类指标"，不能长期冻结。 */
const HEALTH_POLL_MS = 60000;

/**
 * 顶部状态栏。
 *
 * 2026-11-08 改造：dbOk / 最近更新时间改为客户端自检，不再由 layout 服务端注入。
 *
 * 为什么改：layout 之前直接 await getStats()，导致
 *   1) 整棵路由树被 force-dynamic 钉死，页面无法使用 revalidate 缓存；
 *   2) 每次跳转都多一次 DB 查询（首页还会与自身 getStats 重复）；
 *   3) 构建期也会触库，DB 未启动时 npm run build 直接失败。
 * 改为客户端探测后：布局可缓存，状态反而更实时（不必等整页刷新）。
 */
export function TopBar({ displayTz }: TopBarProps) {
  const [currentTime, setCurrentTime] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [dbOk, setDbOk] = useState<boolean | null>(null);
  const [latestGeneratedAt, setLatestGeneratedAt] = useState<string | null>(null);

  // 时钟
  useEffect(() => {
    function updateTime() {
      setCurrentTime(
        new Intl.DateTimeFormat("zh-CN", {
          timeZone: displayTz,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          weekday: "short",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }).format(new Date())
      );
    }
    updateTime();
    const timer = setInterval(updateTime, 60000);
    return () => clearInterval(timer);
  }, [displayTz]);

  // 健康探针：拿连接状态 + 最近更新时间
  useEffect(() => {
    let cancelled = false;

    async function probe() {
      try {
        const res = await fetch("/api/health", { cache: "no-store" });
        const data = (await res.json()) as {
          ok: boolean;
          latestGeneratedAt: string | null;
        };
        if (cancelled) return;
        setDbOk(data.ok === true);
        setLatestGeneratedAt(data.latestGeneratedAt ?? null);
      } catch {
        if (!cancelled) setDbOk(false);
      }
    }

    probe();
    const timer = setInterval(probe, HEALTH_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  function handleRefresh() {
    setIsRefreshing(true);
    window.location.reload();
  }

  return (
    <header className="sticky top-0 z-10 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-panel)]/80 backdrop-blur-md px-4 sm:px-6 py-3 flex items-center justify-between gap-4 flex-wrap">
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2 text-sm">
          {dbOk === false ? (
            <AlertCircle size={16} className="text-[var(--color-warning)]" />
          ) : (
            <Database size={16} className="text-[var(--color-success)]" />
          )}
          <span className="text-[var(--color-text-secondary)]">数据源</span>
          <span className="text-[var(--color-text-primary)] font-medium">PostgreSQL</span>
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] border ${
              dbOk === false
                ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                : "bg-green-500/10 text-green-400 border-green-500/20"
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                dbOk === false ? "bg-amber-400" : "bg-green-400 animate-pulse"
              }`}
            />
            {/* dbOk === null 表示首次探测未回来，此时不宣称"已连接"，也不误报异常 */}
            {dbOk === null ? "检测中" : dbOk ? "已连接" : "连接异常"}
          </span>
        </div>
        {latestGeneratedAt && (
          <span className="text-xs text-[var(--color-text-muted)]">
            最近更新：<span className="text-[var(--color-text-secondary)]">{latestGeneratedAt}</span>
          </span>
        )}
      </div>

      <div className="flex items-center gap-4">
        <span className="text-sm text-[var(--color-text-secondary)] tabular-nums">
          {currentTime}
        </span>
        <button
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-[var(--color-bg-card)] border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-glow)] hover:text-[var(--color-text-primary)] transition-all"
        >
          <RefreshCw size={14} className={isRefreshing ? "animate-spin" : ""} />
          刷新
        </button>
      </div>
    </header>
  );
}
