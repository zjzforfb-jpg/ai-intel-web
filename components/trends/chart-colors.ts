// 图表系列配色。
// 独立成不带 "use client" 的纯模块：服务端页面与客户端图表组件都可安全取值
// （server 组件不能从 client 模块 import 常量，只会拿到 client reference）。
//
// 用 CSS 变量而非固定 hex —— SVG 的 stroke/fill 支持 var()，
// 这样主题切换时图表自动跟着走，不必在客户端读 data-theme 再重算。
// 两套值分别定义在 globals.css 的 [data-theme="dark"] / [data-theme="warm"]。
export const SERIES_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
];
