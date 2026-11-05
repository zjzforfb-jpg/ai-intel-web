"use client";

import { RefreshCw, Database, AlertCircle } from "lucide-react";
import { useState, useEffect } from "react";

interface TopBarProps {
  dbOk: boolean;
  latestGeneratedAt: string | null;
  displayTz: string;
}

export function TopBar({ dbOk, latestGeneratedAt, displayTz }: TopBarProps) {
  const [currentTime, setCurrentTime] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);

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

  function handleRefresh() {
    setIsRefreshing(true);
    window.location.reload();
  }

  return (
    <header className="sticky top-0 z-10 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-panel)]/80 backdrop-blur-md px-4 sm:px-6 py-3 flex items-center justify-between gap-4 flex-wrap">
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2 text-sm">
          {dbOk ? (
            <Database size={16} className="text-[var(--color-success)]" />
          ) : (
            <AlertCircle size={16} className="text-[var(--color-warning)]" />
          )}
          <span className="text-[var(--color-text-secondary)]">数据源</span>
          <span className="text-[var(--color-text-primary)] font-medium">PostgreSQL</span>
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] border ${
              dbOk
                ? "bg-green-500/10 text-green-400 border-green-500/20"
                : "bg-amber-500/10 text-amber-400 border-amber-500/20"
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${dbOk ? "bg-green-400 animate-pulse" : "bg-amber-400"}`}
            />
            {dbOk ? "已连接" : "连接异常"}
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
