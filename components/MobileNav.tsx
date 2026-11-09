"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { NAV_GROUPS, isNavActive } from "@/lib/nav-items";

/**
 * 小屏导航。
 *
 * 2026-11-09 重构前的问题：10 个导航项平铺在横向滚动条里，总宽约 992px，
 * 390px 视口只能看到约 4 项，用户不知道还有 6 项藏在哪里。
 *
 * 现在改为「分组抽屉」：
 *  - 顶栏只留当前所在分组的横向滚动项（最多 5 项，基本都能放下）；
 *  - 右侧「菜单」按钮展开全部分组。
 */
export function MobileNav() {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeGroup, setActiveGroup] = useState(0);
  const drawerRef = useRef<HTMLDivElement | null>(null);

  // 路径变化时：定位到当前激活项所属分组，并收起抽屉
  useEffect(() => {
    const idx = NAV_GROUPS.findIndex((g) =>
      g.items.some((item) => isNavActive(item.href, pathname))
    );
    if (idx >= 0) setActiveGroup(idx);
    setDrawerOpen(false);
  }, [pathname]);

  // 抽屉打开时禁止背景滚动
  useEffect(() => {
    if (!drawerOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [drawerOpen]);

  // Esc 关闭抽屉
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  const group = NAV_GROUPS[activeGroup] ?? NAV_GROUPS[0];

  return (
    <>
      <nav className="md:hidden flex items-center gap-1 px-3 py-2 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-panel)]">
        {/* 分组切换：显示三个分组名，当前组高亮 */}
        <div className="flex items-center gap-1 shrink-0">
          {NAV_GROUPS.map((g, i) => (
            <button
              key={g.label}
              onClick={() => setActiveGroup(i)}
              aria-pressed={i === activeGroup}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                i === activeGroup
                  ? "bg-[var(--color-accent)] text-[var(--color-on-accent)]"
                  : "text-[var(--color-text-muted)]"
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>

        {/* 当前分组的横向项 */}
        <div className="flex items-center gap-1 overflow-x-auto flex-1 min-w-0 ml-1">
          {group.items.map((item) => {
            const Icon = item.icon;
            const isActive = isNavActive(item.href, pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs whitespace-nowrap transition-colors ${
                  isActive
                    ? "bg-[var(--color-accent-glow)] text-[var(--color-accent-light)] font-medium"
                    : "text-[var(--color-text-secondary)]"
                }`}
              >
                <Icon size={14} />
                {item.label}
              </Link>
            );
          })}
        </div>

        {/* 全量菜单 */}
        <button
          onClick={() => setDrawerOpen(true)}
          aria-label="打开完整导航菜单"
          className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-lg border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)]"
        >
          <Menu size={16} />
        </button>
      </nav>

      {/* 抽屉 */}
      {drawerOpen && (
        <div
          className="md:hidden fixed inset-0 z-50"
          role="dialog"
          aria-modal="true"
          aria-label="完整导航菜单"
        >
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setDrawerOpen(false)}
          />
          <div
            ref={drawerRef}
            className="absolute right-0 top-0 bottom-0 w-[248px] bg-[var(--color-bg-panel)] border-l border-[var(--color-border-subtle)] overflow-y-auto"
          >
            <div className="flex items-center justify-between px-4 py-4 border-b border-[var(--color-border-subtle)]">
              <span className="text-sm font-semibold text-[var(--color-text-primary)]">
                全部导航
              </span>
              <button
                onClick={() => setDrawerOpen(false)}
                aria-label="关闭菜单"
                className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-[var(--color-text-secondary)]"
              >
                <X size={18} />
              </button>
            </div>
            <nav className="px-3 py-3">
              {NAV_GROUPS.map((g) => (
                <div key={g.label} className="mb-4 last:mb-0">
                  <div className="px-3 pb-1.5 text-[11px] font-medium text-[var(--color-text-muted)]">
                    {g.label}
                  </div>
                  <div className="flex flex-col gap-0.5">
                    {g.items.map((item) => {
                      const Icon = item.icon;
                      const isActive = isNavActive(item.href, pathname);
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          aria-current={isActive ? "page" : undefined}
                          className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                            isActive
                              ? "bg-[var(--color-accent)] text-[var(--color-on-accent)] font-medium"
                              : "text-[var(--color-text-secondary)]"
                          }`}
                        >
                          <Icon size={16} className="shrink-0" />
                          {item.label}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
            </nav>
          </div>
        </div>
      )}
    </>
  );
}
