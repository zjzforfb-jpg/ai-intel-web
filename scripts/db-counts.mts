#!/usr/bin/env node
// 阶段 E 辅助：打印关键表行数（用于幂等性验证）
// 用法：node --env-file=.env.local --import tsx scripts/db-counts.mts
//
// 注意：report_failures 对只读账号 ai_intel_reader 没有授权（它属于 monitor 层），
// 所以这里不查它，否则整个脚本会被 aclcheck_error 打断。
import { Client } from "pg";

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
  `SELECT 'daily_reports' AS t, count(*)::int AS n FROM daily_reports
   UNION ALL SELECT 'opportunities', count(*)::int FROM opportunities
   UNION ALL SELECT 'topic_ideas', count(*)::int FROM topic_ideas
   ORDER BY 1`
);
for (const r of res.rows) console.log(`${r.t}\t${r.n}`);
await client.end();
