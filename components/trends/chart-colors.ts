// 图表系列配色（与 :root 深色色板同系）
// 独立成不带 "use client" 的纯模块：服务端页面与客户端图表组件都可安全取值
// （server 组件不能从 client 模块 import 常量，只会拿到 client reference）
export const SERIES_COLORS = [
  "#818cf8",
  "#34d399",
  "#f59e0b",
  "#c084fc",
  "#60a5fa",
  "#f472b6",
];
