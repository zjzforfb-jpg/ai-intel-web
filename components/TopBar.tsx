"use client";

import { RefreshCw, Database, AlertCircle, Monitor, Moon, Sun } from "lucide-react";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "@/components/ThemeProvider";

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
 *
 * 2026-11-09 版式重构修正三处：
 *  1. 健康三态原本 null（检测中）与 true（已连接）配色完全相同，只靠文案区分；
 *     现在三态各有独立配色与图标。
 *  2. 刷新按钮原本用 window.location.reload() 硬刷新整页，且 isRefreshing 永不置回 false；
 *     改为 router.refresh()，只重取 RSC 数据，不丢客户端状态。
 *  3. 最近更新时间原本直接渲染 PG 的 timestamptz 原文（未走时区归一）；
 *     现在统一用 Intl 按 displayTz 格式化。
 */
export function TopBar({ displayTz }: TopBarProps) {
  const router = useRouter();
  const { resolved, setPreference } = useTheme();
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

  /** 把最近更新时间按展示时区格式化（PG 返回的是 timestamptz 原文） */
  const latestText = (() => {
    if (!latestGeneratedAt) return null;
    const d = new Date(latestGeneratedAt);
    if (Number.isNaN(d.getTime())) return latestGeneratedAt;
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: displayTz,
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(d);
  })();

  function handleRefresh() {
    setIsRefreshing(true);
    router.refresh();
    // 恢复按钮态（router.refresh 不改变路由，动画转一圈即可）
    window.setTimeout(() => setIsRefreshing(false), 600);
  }

  function toggleTheme() {
    setPreference(resolved === "dark" ? "warm" : "dark");
  }

  return (
    <header className="sticky top-0 z-10 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-panel)]/80 backdrop-blur-md px-4 sm:px-6 py-2.5 flex items-center justify-between gap-4 flex-wrap">
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2 text-sm">
          {dbOk === false ? (
            <AlertCircle size={16} className="text-[var(--color-danger)]" />
          ) : dbOk === null ? (
            <Monitor size={16} className="text-[var(--color-text-muted)]" />
          ) : (
            <Database size={16} className="text-[var(--color-success)]" />
          )}
          <span className="text-[var(--color-text-secondary)]">数据源</span>
          <span className="text-[var(--color-text-primary)] font-medium">PostgreSQL</span>
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] border ${
              dbOk === false
                ? "text-[var(--color-danger)] border-[color-mix(in_srgb,var(--color-danger)_40%,transparent)] bg-[color-mix(in_srgb,var(--color-danger)_10%,transparent)]"
                : dbOk === null
                  ? "text-[var(--color-text-muted)] border-[var(--color-border-subtle)] bg-[var(--color-bg-card)]"
                  : "text-[var(--color-success)] border-[color-mix(in_srgb,var(--color-success)_40%,transparent)] bg-[color-mix(in_srgb,var(--color-success)_10%,transparent)]"
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                dbOk === false
                  ? "bg-[var(--color-danger)]"
                  : dbOk === null
                    ? "bg-[var(--color-text-muted)]"
                    : "bg-[var(--color-success)] animate-pulse"
              }`}
            />
            {/* dbOk === null 表示首次探测未回来，此时不宣称"已连接"，也不误报异常 */}
            {dbOk === null ? "检测中" : dbOk ? "已连接" : "连接异常"}
          </span>
        </div>
        {latestText && (
          <span className="text-xs text-[var(--color-text-muted)]">
            最近更新：
            <span className="text-[var(--color-text-secondary)] tnum">{latestText}</span>
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        <span className="hidden sm:inline text-sm text-[var(--color-text-secondary)] tabular-nums">
          {currentTime}
        </span>

        {/* 主题切换 */}
        <button
          onClick={toggleTheme}
          aria-label={resolved === "dark" ? "切换到暖风主题" : "切换到暗黑主题"}
          title={resolved === "dark" ? "切换到暖风主题" : "切换到暗黑主题"}
          className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-glow)] hover:text-[var(--color-text-primary)] transition-colors"
        >
          {resolved === "dark" ? (
            <Sun size={15} />
          ) : (
            <Moon size={15} />
          )}
        </button>

        <button
          onClick={handleRefresh}
          disabled={isRefreshing}
          aria-label="刷新数据"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-[var(--color-bg-card)] border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-glow)] hover:text-[var(--color-text-primary)] transition-all"
        >
          <RefreshCw size={14} className={isRefreshing ? "animate-spin" : ""} />
          <span className="hidden sm:inline">刷新</span>
        </button>
      </div>
    </header>
  );
}
