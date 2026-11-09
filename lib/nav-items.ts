import type { LucideIcon } from "lucide-react";
import {
  Newspaper,
  Archive,
  TrendingUp,
  Network,
  Crosshair,
  Lightbulb,
  Clapperboard,
  Briefcase,
  Activity,
  Info,
} from "lucide-react";

/**
 * 全站导航唯一真源。
 *
 * 2026-11-09 之前 Sidebar.tsx 与 MobileNav.tsx 各自内联了一份逐字节重复的
 * navItems 数组，两处需要手工同步 —— 已经出过漂移风险。
 * 现在统一收敛到这里，Sidebar / MobileNav / 未来的抽屉式导航都从这里取。
 *
 * 分组为「情报 / 生产 / 系统」三级，对应线框图 2:43 组件库的 Shell/Sidebar。
 */
export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "情报",
    items: [
      { href: "/", label: "今日情报", icon: Newspaper },
      { href: "/history", label: "历史报告", icon: Archive },
      { href: "/trends", label: "趋势观察", icon: TrendingUp },
      { href: "/entities", label: "实体追踪", icon: Network },
      { href: "/topics", label: "专题追踪", icon: Crosshair },
    ],
  },
  {
    label: "生产",
    items: [
      { href: "/ideas", label: "短视频选题", icon: Lightbulb },
      { href: "/content", label: "内容生产", icon: Clapperboard },
      { href: "/opportunities", label: "商业机会", icon: Briefcase },
    ],
  },
  {
    label: "系统",
    items: [
      { href: "/monitor", label: "系统监控", icon: Activity },
      { href: "/about", label: "关于平台", icon: Info },
    ],
  },
];

/** 扁平化后的全部导航项（移动端下拉、搜索、面包屑共用） */
export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

/**
 * 判断某导航项在当前路径下是否激活。
 *
 * 规则：根路径 "/" 只在精确匹配时激活（否则所有页面都会命中 "/"）；
 * 其余路径用前缀匹配，使 "/ideas" 的详情页 "/ideas/xxx" 也能保持父项高亮。
 */
export function isNavActive(href: string, pathname: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}
