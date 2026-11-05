import type { NextConfig } from "next";

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
  // 使用标准渲染模型：页面通过 dynamic = "force-dynamic" 每次读取最新日报
};

export default nextConfig;
