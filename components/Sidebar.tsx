"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_GROUPS, isNavActive } from "@/lib/nav-items";

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden md:flex w-60 shrink-0 border-r border-[var(--color-border-subtle)] bg-[var(--color-bg-panel)] flex-col h-screen sticky top-0">
      {/* Logo */}
      <div className="px-5 py-6 border-b border-[var(--color-border-subtle)]">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-[var(--color-accent)] flex items-center justify-center">
            <span className="text-[var(--color-on-accent)] font-bold text-sm">AI</span>
          </div>
          <div>
            <div className="text-sm font-semibold text-[var(--color-text-primary)] leading-tight">
              每日 AI 情报内参
            </div>
            <div className="text-[10px] text-[var(--color-text-muted)] tracking-wider">
              DAILY AI INTELLIGENCE
            </div>
          </div>
        </div>
      </div>

      {/* Nav：三级分组（情报 / 生产 / 系统） */}
      <nav className="flex-1 px-3 py-4 overflow-y-auto">
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="mb-4 last:mb-0">
            <div className="px-3 pb-1.5 text-[11px] font-medium text-[var(--color-text-muted)]">
              {group.label}
            </div>
            <div className="flex flex-col gap-0.5">
              {group.items.map((item) => {
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
                        : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-card)] hover:text-[var(--color-text-primary)]"
                    }`}
                  >
                    <Icon size={17} className="shrink-0" />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-[var(--color-border-subtle)]">
        <div className="text-[10px] text-[var(--color-text-muted)]">
          Powered by n8n + PostgreSQL
        </div>
        <div className="text-[10px] text-[var(--color-text-muted)] mt-1">
          Self-hosted · Local Only
        </div>
      </div>
    </aside>
  );
}
