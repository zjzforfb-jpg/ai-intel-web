import type { NextConfig } from "next";

/**
 * ISR 页面（带 `export const revalidate`）默认只发 `s-maxage`、不发 `max-age`，
 * 浏览器因此可能长期持有旧 HTML。
 *
 * 而每次 `next build` 都会换掉静态资源的 content hash —— 旧 HTML 引用的
 * `/_next/static/chunks/<旧hash>.css` 已被删除，浏览器拿到 404，
 * 结果就是整页裸奔（无样式、链接变默认蓝）。
 *
 * 给这几个 ISR 路由补 `max-age=0, must-revalidate`：浏览器每次都会带 ETag 协商，
 * 未变更时仍返回 304（本地开销可忽略），构建后则会立刻拿到新 HTML。
 * 服务端 ISR 缓存不受响应头影响，仍然照常工作。
 *
 * 注：`force-dynamic` 页面本来就发 `no-store`，无需处理；
 * 以后新增带 `revalidate` 的路由，记得在这里补一条。
 */
const HTML_REVALIDATE = [
  { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Tailwind CSS v4 需要该 Turbopack loader 才能扫描源码并生成工具类
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      { source: "/", headers: HTML_REVALIDATE },
      { source: "/about", headers: HTML_REVALIDATE },
      { source: "/topics/new", headers: HTML_REVALIDATE },
      { source: "/report/:date*", headers: HTML_REVALIDATE },
    ];
  },
  // 使用标准渲染模型：页面通过 dynamic = "force-dynamic" 每次读取最新日报
};

export default nextConfig;
