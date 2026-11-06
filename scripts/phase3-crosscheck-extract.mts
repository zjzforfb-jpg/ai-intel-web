// 阶段 3 交叉验证：App 侧（lib/entities-extract.ts）与 n8n 侧（Code 节点）
// 的实体抽取结果必须一致 —— 否则会出现「同一篇日报，页面显示 5 个实体，
// n8n 却写进去 8 个」这种最难排查的问题。
//
// 用法：node --env-file=.env.local --import tsx scripts/phase3-crosscheck-extract.mts
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { Client } from "pg";
import { extractEntityMentions } from "../lib/entities-extract.js";

const n8nCode = readFileSync("/tmp/n8n-verify/entity-extract.js", "utf8");

const client = new Client({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: false,
});
await client.connect();
const res = await client.query(
  `SELECT report_date::text AS d, report_markdown FROM daily_reports WHERE report_markdown IS NOT NULL ORDER BY report_date`
);
await client.end();

let mismatch = 0;

for (const row of res.rows) {
  const reportDate = row.d as string;
  const markdown = row.report_markdown as string;

  // App 侧
  const appSide = extractEntityMentions({ reportDate, reportMarkdown: markdown });

  // n8n 侧
  const ctx: any = { $json: { report_date: reportDate, report_markdown: markdown } };
  vm.createContext(ctx);
  const fn = vm.runInContext(`(async () => { ${n8nCode} })`, ctx);
  const n8nOut: any[] = await fn();
  const n8nSide = n8nOut.map((o) => o.json);

  const keyOf = (m: any) => `${m.normalized_name || m.normalizedName}|${m.source_title || m.sourceTitle || ""}`;
  const appKeys = appSide.map(keyOf).sort();
  const n8nKeys = n8nSide.map(keyOf).sort();

  const same = JSON.stringify(appKeys) === JSON.stringify(n8nKeys);
  console.log(`\n${reportDate}: App ${appSide.length} 条 / n8n ${n8nSide.length} 条 → ${same ? "一致 ✓" : "不一致 ✗"}`);

  if (!same) {
    mismatch++;
    const onlyApp = appKeys.filter((k) => !n8nKeys.includes(k));
    const onlyN8n = n8nKeys.filter((k) => !appKeys.includes(k));
    if (onlyApp.length) console.log("  仅 App 有:", onlyApp.join(" | "));
    if (onlyN8n.length) console.log("  仅 n8n 有:", onlyN8n.join(" | "));
  } else {
    // 逐字段比对分数与类型
    const byKey = new Map(n8nSide.map((m: any) => [keyOf(m), m]));
    for (const a of appSide) {
      const n = byKey.get(keyOf(a));
      if (!n) continue;
      const score = a.importanceScore;
      if (score !== n.importance_score) {
        console.log(`  ✗ 分数不一致 ${a.normalizedName}: app=${score} n8n=${n.importance_score}`);
        mismatch++;
      }
      if (a.entityType !== n.entity_type) {
        console.log(`  ✗ 类型不一致 ${a.normalizedName}: app=${a.entityType} n8n=${n.entity_type}`);
        mismatch++;
      }
    }
    console.log(`  示例: ${appSide.slice(0, 3).map((m) => `${m.normalizedName}(${m.importanceScore})`).join(", ")}`);
  }
}

console.log(mismatch === 0 ? "\n交叉验证通过：两侧抽取结果一致" : `\n交叉验证失败：${mismatch} 处不一致`);
process.exit(mismatch === 0 ? 0 : 1);
