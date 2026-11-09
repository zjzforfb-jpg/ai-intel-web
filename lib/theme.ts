/**
 * 主题机制（暗黑 / 暖风 / 跟随系统）。
 *
 * 2026-11-09 之前项目里**完全没有**主题能力：
 * prefers-color-scheme / data-theme / dark: / next-themes 全部零命中。
 * 本文件建立最小可用的三层机制：
 *
 *  1. 服务端：layout.tsx 注入内联脚本，在首帧之前把 data-theme 写到 <html>，
 *     避免「先亮后暗」的闪烁（客户端 useEffect 一定晚于首帧）。
 *  2. 客户端：ThemeProvider 监听系统偏好变化，提供当前主题与切换动作。
 *  3. 存储：localStorage 持久化用户显式选择；未选择时跟随系统。
 *
 * 为什么自己实现而不用 next-themes：
 * 项目规模小（17 页），next-themes 会带来额外依赖与 hydration 边界问题；
 * 且项目要求「不影响现有功能」，自实现可以完全掌控注入时机。
 */

export const THEMES = ["dark", "warm", "system"] as const;
export type Theme = (typeof THEMES)[number];

/** 用户显式选择时写入 localStorage 的键 */
export const THEME_STORAGE_KEY = "ai-intel-theme";

/** 系统偏好对应的实际主题 */
export type ResolvedTheme = "dark" | "warm";

/**
 * 注入到 <head> 的内联脚本。
 *
 * 必须在 React 水合之前同步执行，否则会出现浅色闪一下再变暗。
 * 逻辑刻意保持极简（无 try/catch 包裹的复杂分支），
 * 因为任何异常都会导致主题不生效。
 */
export const themeInitScript = `(function(){try{
var k=${JSON.stringify(THEME_STORAGE_KEY)};
var t=localStorage.getItem(k);
if(t!=="warm"&&t!=="dark"&&t!=="system"){t="system";}
var r=t;
if(t==="system"){r=window.matchMedia("(prefers-color-scheme: light)").matches?"warm":"dark";}
document.documentElement.setAttribute("data-theme",r);
document.documentElement.style.colorScheme=r;
}catch(e){}})();`;

/** 把偏好解析为实际生效的主题 */
export function resolveTheme(theme: Theme, prefersLight: boolean): ResolvedTheme {
  if (theme === "system") return prefersLight ? "warm" : "dark";
  return theme;
}

/** 读取 localStorage 中的偏好（客户端专用） */
export function readStoredTheme(): Theme {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (raw === "warm" || raw === "dark" || raw === "system") return raw;
  } catch {
    // 隐私模式 / 存储被禁用时静默降级为 system
  }
  return "system";
}
