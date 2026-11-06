// 阶段 D 辅助：用真实日报样本验证「格式化数据」节点的字段覆盖率检查是否生效
// 用法：node --env-file=.env.local --import tsx scripts/phase2-verify-format-node.mts
//
// 为什么需要它：headlines_field_coverage 只有在真实 Markdown 上跑过才能确认
// 正则和章节切分是对的，光看代码看不出来（阶段 D 就踩过空章节的坑）。
import { readFileSync } from "node:fs";
import { Client } from "pg";

const FORMAT_NODE_PATH = process.argv[2] ?? "/tmp/n8n-verify/format-node.js";
const code = readFileSync(FORMAT_NODE_PATH, "utf8");

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
  `SELECT report_date::text AS d, report_markdown, total_articles, headline_count
   FROM daily_reports WHERE report_markdown IS NOT NULL ORDER BY report_date`
);
await client.end();

let failed = 0;
for (const row of res.rows) {
  const items = [
    {
      json: {
        text: row.report_markdown,
        report_date: row.d,
        total_articles: row.total_articles,
        headline_count: row.headline_count,
      },
    },
  ];
  const $input = { all: () => items, first: () => items[0] };
  const $json = items[0].json;
  const $ = (_name: string) => ({ first: () => ({ json: items[0].json }) });

  const fn = new Function(
    "$input",
    "$json",
    "$",
    `return (async () => { ${code}\n })();`
  );
  try {
    const out = await fn($input, $json, $);
    const j = out?.[0]?.json ?? {};
    const v = j.validation ?? {};
    const ok = typeof v.headlines_field_coverage === "number";
    if (!ok) failed++;
    console.log(
      `${row.d}  头条=${j.headline_count}  有字段=${v.headlines_with_fields}  覆盖率=${v.headlines_field_coverage}  status=${j.status}  ${ok ? "✓" : "✗ 字段缺失"}`
    );
  } catch (e) {
    failed++;
    console.log(`${row.d}  ✗ 执行失败: ${(e as Error).message}`);
  }
}
process.exit(failed === 0 ? 0 : 1);
