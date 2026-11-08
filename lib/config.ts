// 共享运行配置 —— 端口/时区等需要多处引用的值集中在这里
//
// 为什么要有这个文件：候选端口 5433 曾散落在 4 处源码 + 3 处测试里，
// 改端口要改 7 个地方，漏一处就会出现「页面提示连 5433，实际连别处」的误导。

/** PostgreSQL 端口（Docker 容器 n8n-radar-postgres 映射到宿主 5433） */
export const DB_PORT = process.env.DB_PORT ?? "5433";

/** 展示时区：数据库存 timestamptz，页面统一按这个时区渲染 */
export const DISPLAY_TZ = process.env.DISPLAY_TZ ?? "Asia/Shanghai";

/**
 * 数据库排障提示语。
 *
 * 抽成函数而不是在 8 个页面里各写一遍模板字符串 —— 那些字符串已经出现过
 * 「只读账号」/「数据库账号」两种措辞，改一处漏一处就会不一致。
 */
export function dbHint(account: "reader" | "writer" | "any" = "any"): string {
  const accountText =
    account === "reader" ? "只读账号" : account === "writer" ? "写入账号" : "数据库账号";
  return `可检查：Docker 中 n8n-radar-postgres 是否在运行、127.0.0.1:${DB_PORT} 是否可连、${accountText}凭据是否有效。`;
}
