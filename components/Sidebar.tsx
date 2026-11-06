"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Newspaper, Archive, TrendingUp, Crosshair, Lightbulb, Briefcase, Activity, Info } from "lucide-react";

const navItems = [
  { href: "/", label: "今日情报", icon: Newspaper },
  { href: "/history", label: "历史报告", icon: Archive },
  { href: "/trends", label: "趋势观察", icon: TrendingUp },
  { href: "/topics", label: "专题追踪", icon: Crosshair },
  { href: "/ideas", label: "短视频选题", icon: Lightbulb },
  { href: "/opportunities", label: "商业机会", icon: Briefcase },
  { href: "/monitor", label: "系统监控", icon: Activity },
  { href: "/about", label: "关于平台", icon: Info },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden md:flex w-60 shrink-0 border-r border-[var(--color-border-subtle)] bg-[var(--color-bg-panel)] flex-col h-screen sticky top-0">
      {/* Logo */}
      <div className="px-5 py-6 border-b border-[var(--color-border-subtle)]">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-500 to-blue-500 flex items-center justify-center glow-accent">
            <span className="text-white font-bold text-sm">AI</span>
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

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all ${
                isActive
                  ? "bg-[var(--color-accent-glow)] text-[var(--color-accent-light)] border border-[var(--color-border-glow)]"
                  : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-card)] hover:text-[var(--color-text-primary)]"
              }`}
            >
              <Icon size={18} className="shrink-0" />
              <span>{item.label}</span>
            </Link>
          );
        })}
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
