"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Newspaper, Archive, TrendingUp, Briefcase, Info } from "lucide-react";

const navItems = [
  { href: "/", label: "今日情报", icon: Newspaper },
  { href: "/history", label: "历史报告", icon: Archive },
  { href: "/trends", label: "趋势观察", icon: TrendingUp },
  { href: "/opportunities", label: "商业机会", icon: Briefcase },
  { href: "/about", label: "关于平台", icon: Info },
];

/** 小屏替代左侧导航栏的横向导航 */
export function MobileNav() {
  const pathname = usePathname();

  return (
    <nav className="md:hidden flex items-center gap-1 px-3 py-2 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-panel)] overflow-x-auto">
      {navItems.map((item) => {
        const Icon = item.icon;
        const isActive =
          item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs whitespace-nowrap transition-colors ${
              isActive
                ? "bg-[var(--color-accent-glow)] text-[var(--color-accent-light)] border border-[var(--color-border-glow)]"
                : "text-[var(--color-text-secondary)] border border-transparent"
            }`}
          >
            <Icon size={14} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
